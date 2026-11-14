/**
 * 缩略图渲染 / 缓存路径 / 写入侧预热 —— 按需生成（中间件）与提前预热（上传、产出落库）共用。
 *
 * ## 为什么单拎一层出来
 *
 * 用 Jimp 解码一张 9MP 手机照片实测约 1.0–1.3s（纯 JS 解码，且是**同步**占满
 * 主线程），裁切 + 编码再花 0.4–0.7s。也就是说一张图的缩略图约 1.8s，期间整个
 * Node 事件循环被占住，接口与静态资源一起变慢。
 *
 * 素材库弹窗一屏 20 多张、列表上限 120 张 —— 全部按需生成的话，用户看到的是
 * 「格子一直灰着、图慢慢往外冒」，这就是「从素材库导入没加载完图片」的真正原因。
 *
 * 结论：缩略图不该等到浏览时才算。写入侧（上传 / AI 产出落库）此刻**已经**
 * 解码过这张图，顺手把缩略图算出来落盘，浏览时就是纯磁盘读（约 2ms）。
 * 本文件把这套「解码 → 裁切 → 编码 → 落盘」抽出来，避免中间件与预热各写一份。
 *
 * ## 变体命名
 *
 * 缓存目录 `<UPLOAD_DIR>/.thumbs/<w>x<h|auto>/<key>.jpg` 与 URL 参数
 * `?w=&h=` 一一对应 —— 同一张图不同尺寸是不同文件，故预热时必须**照着前端
 * 实际请求的尺寸**来算，否则预热了也用不上（见 `WARM_THUMB_SPECS`）。
 */
import { promises as fsp } from 'fs';
import { dirname, join } from 'path';
import { Jimp, JimpMime } from 'jimp';
import type { JimpInstance } from 'jimp';
import { deploymentUploadMaxPixels } from '../common/image-formats';
import { detectImageMime, readImageDimensions } from './image-validation';

const JPEG_QUALITY = 78;
/** 只限宽时的额外高度上限：避免极端长图生成超大位图 */
const MAX_AUTO_HEIGHT = 1280;

/** 一个缩略图变体：`h` 为 null 表示只限宽、保留原图比例 */
export interface ThumbSpec {
  w: number;
  h: number | null;
}

/** 素材库导入弹窗（480²，方形裁切）—— 同时被工具页历史面板复用 */
export const PICKER_THUMB: ThumbSpec = { w: 480, h: 480 };
/** 素材库 /library 瀑布流（640 宽、保留比例） */
export const BROWSE_THUMB: ThumbSpec = { w: 640, h: null };

/**
 * 写入侧预热的变体清单。
 *
 * ⚠ 必须与前端 `assetThumbSrc()` 的调用尺寸保持一致：
 *   - `AssetLibraryModal` → 480²
 *   - `ToolHistoryPane` → 480²
 *   - `LibraryAssetCard`（/library 网格） → 640 保留比例
 * 工具页结果卡用 320²，但一次只有几张、且随任务产出即时请求，不预热。
 */
export const WARM_THUMB_SPECS: ThumbSpec[] = [PICKER_THUMB, BROWSE_THUMB];

/** 缓存文件绝对路径；`h=null` 的变体目录名用 `auto`，与中间件解析 query 的规则一致 */
export function thumbCacheFile(uploadsDir: string, key: string, spec: ThumbSpec): string {
  return join(uploadsDir, '.thumbs', `${spec.w}x${spec.h ?? 'auto'}`, `${key}.jpg`);
}

/** 读缓存；不存在 / 读失败一律返回 null，由调用方决定是否重新生成 */
export function readThumbCache(file: string): Promise<Buffer | null> {
  return fsp.readFile(file).catch(() => null);
}

/**
 * 按变体规约缩放（就地修改传入的 image）。
 *
 * `h === null`：只限宽等比缩放；`h` 有值：方形裁切（cover）。
 */
function fitSpec(image: JimpInstance, spec: ThumbSpec): void {
  if (spec.h === null) {
    image.resize(
      widthOnlyDimensions(image.bitmap.width, image.bitmap.height, spec.w, MAX_AUTO_HEIGHT),
    );
  } else {
    image.cover({ w: spec.w, h: spec.h });
  }
}

/**
 * 编码 JPEG。透明图先铺白底再合，否则 alpha 会被编码成黑底。
 */
async function encodeJpeg(image: JimpInstance): Promise<Buffer> {
  if (!image.hasAlpha()) {
    return image.getBuffer(JimpMime.jpeg, { quality: JPEG_QUALITY });
  }
  const canvas = new Jimp({
    width: image.bitmap.width,
    height: image.bitmap.height,
    color: 0xffffffff,
  });
  canvas.composite(image, 0, 0);
  return canvas.getBuffer(JimpMime.jpeg, { quality: JPEG_QUALITY });
}

/**
 * 从**已解码**的位图产出一个变体。
 *
 * 内部先 `clone()`：一次解码要产出多个变体，`cover()` / `resize()` 都是就地修改，
 * 不克隆的话第二个变体会拿到已被裁成方形的图。
 */
export async function renderThumbFromImage(image: JimpInstance, spec: ThumbSpec): Promise<Buffer> {
  const target = image.clone();
  fitSpec(target, spec);
  return encodeJpeg(target);
}

/**
 * 解码一次 → 产出多个变体。
 *
 * 返回空数组表示这张图不可解码（视频 / WebP / 损坏 / 超像素上限），调用方应
 * 回落原文件，**不是**报错 —— 与改造前的行为一致。
 */
export async function renderThumbsFromBuffer(
  source: Buffer,
  specs: ThumbSpec[],
): Promise<Array<{ spec: ThumbSpec; body: Buffer }>> {
  const mime = detectImageMime(source);
  if (!mime) return [];
  const dims = readImageDimensions(source, mime);
  // 解码炸弹防护: 与上传侧同一像素上限，超限不解码
  if (!dims || dims.width * dims.height > deploymentUploadMaxPixels()) return [];

  let image: JimpInstance;
  try {
    // jimp 1.x 的 d.ts 里 esm / commonjs 两份声明并存，`read()` 的返回值与
    // `JimpInstance` 会被 TS 判成「同名但不相干」的两个类型；显式收敛即可。
    image = (await Jimp.read(source)) as unknown as JimpInstance;
  } catch {
    return [];
  }

  const out: Array<{ spec: ThumbSpec; body: Buffer }> = [];
  for (const spec of specs) {
    try {
      out.push({ spec, body: await renderThumbFromImage(image, spec) });
    } catch {
      // 单个变体失败不影响其他变体
    }
  }
  return out;
}

/** 落盘缓存；失败不影响调用方（例如只读部署） */
export async function saveThumbCache(file: string, body: Buffer): Promise<void> {
  await fsp.mkdir(dirname(file), { recursive: true }).catch(() => undefined);
  await fsp.writeFile(file, body).catch(() => undefined);
}

/** 同一张图同一变体正在预热时，不重复排队 */
const warming = new Set<string>();

/**
 * 本地缩略图开关 —— 与 `main.ts` 注册中间件时读的是同一个环境变量
 * （`ASSET_THUMBNAIL_ENABLED`，默认关闭）。
 *
 * 预热必须在开关关闭时**跳过**：关闭态下带 `?w=` 的请求由静态服务直接返回原图，
 * 缓存没有人消费，预热等于为不存在的读者白解码一遍（一张 9MP 照片 1s+）。
 * 这里直接读 `process.env`：@nestjs/config 启动时已把 .env 写进 process.env，
 * 而该键是「改环境变量即生效」的部署级配置，不在后台动态设置里。
 */
function thumbnailsEnabled(): boolean {
  const raw = (process.env.ASSET_THUMBNAIL_ENABLED ?? '').trim().toLowerCase();
  return raw === 'true' || raw === '1';
}

/**
 * 写入侧预热：把这张图的缩略图提前算好落盘。
 *
 * ## 用法
 *
 * 上传（`AssetsService.createOriginal`）与产出落库（`task-media.service`）在
 * **已经解码过**这张图之后调用，传 `image` 可省掉一次解码。
 *
 * ## 提示
 *
 * 本函数永不抛错、也不阻塞调用方（返回值只用于测试等待）——
 * 预热失败最多是回到「浏览时按需生成」，不该让上传 / 落库跟着失败。
 */
export async function warmThumbnails(options: {
  uploadsDir: string;
  /** 存储 key，如 `original/202611/xxx.jpg` */
  key: string;
  /** 已解码的位图（上传路径有；产出落库只有 buffer） */
  image?: JimpInstance | null;
  /** 原文件内容；没有 image 时用它解码 */
  source?: Buffer | null;
  specs?: ThumbSpec[];
}): Promise<void> {
  const { uploadsDir, key } = options;
  const specs = options.specs ?? WARM_THUMB_SPECS;
  if (!uploadsDir || !key) return;
  if (!thumbnailsEnabled()) return;

  const targets = specs.map((spec) => ({ spec, file: thumbCacheFile(uploadsDir, key, spec) }));
  if (warming.has(key)) return;
  warming.add(key);
  try {
    const missing: typeof targets = [];
    for (const target of targets) {
      if (!(await readThumbCache(target.file))) missing.push(target);
    }
    if (missing.length === 0) return;

    if (options.image) {
      for (const target of missing) {
        try {
          await saveThumbCache(target.file, await renderThumbFromImage(options.image, target.spec));
        } catch {
          // 单个变体失败忽略
        }
      }
      return;
    }

    if (!options.source) return;
    const rendered = await renderThumbsFromBuffer(
      options.source,
      missing.map((t) => t.spec),
    );
    for (const { spec, body } of rendered) {
      const file = thumbCacheFile(uploadsDir, key, spec);
      await saveThumbCache(file, body);
    }
  } finally {
    warming.delete(key);
  }
}

/** 只限宽时保持比例；极端长图额外限制高度，避免生成超大位图。 */
function widthOnlyDimensions(
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  maxHeight: number,
): { w: number; h: number } {
  const proportionalHeight = Math.max(1, Math.round((sourceHeight / sourceWidth) * targetWidth));
  if (proportionalHeight <= maxHeight) return { w: targetWidth, h: proportionalHeight };
  return {
    w: Math.max(1, Math.round((sourceWidth / sourceHeight) * maxHeight)),
    h: maxHeight,
  };
}
