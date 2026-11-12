/**
 * `/uploads/*` 素材缩略图中间件。
 *
 * ## 为什么需要
 *
 * 素材库是纯图网格, 卡片实际只有 200 多像素, 但接口给的是原图 —— 本机实测
 * 首屏 20 张合计约 29MB (单张最大 3.4MB)。素材一多, 图片加载和内存都会被
 * 原图拖垮。这里按 URL 上的 `w` / `h` 生成 JPEG 缩略图并落盘缓存:
 * 同时传 `w` / `h` 时裁成指定尺寸; 只传 `w` 时保持原图纵横比。
 * 同尺寸重复请求直接读缓存。
 *
 * ## 回落语义
 *
 * 未带 `w`、不是图片 (视频素材)、解码失败 (如 WebP) 时一律 `next()`,
 * 交给后面的静态服务返回原文件 —— 行为与改造前完全一致, 不会把素材变成 404。
 *
 * ## 注册顺序
 *
 * 必须在签名中间件**之后** (复用同一份访问校验)、`useStaticAssets` **之前**
 * (静态中间件命中即响应, 注册在后面就拿不到缩略图了)。
 *
 * 缓存目录在 `<UPLOAD_DIR>/.thumbs/<w>x<h|auto>/<key>.jpg`。素材 key 带随机段且
 * 从不原地覆盖, 因此缓存文件不会过期; 删除素材时 `AssetsService.remove()`
 * 会一并清理所有尺寸变体。
 */
import { promises as fsp } from 'fs';
import { dirname, join, resolve } from 'path';
import type { NextFunction, Request, Response } from 'express';
import { Jimp, JimpMime } from 'jimp';
import { assertSafeKey } from '../storage/storage.provider';
import { detectImageMime, maxUploadPixels, readImageDimensions } from './image-validation';

const MIN_SIZE = 32;
const MAX_SIZE = 1280;
const DEFAULT_SIZE = 640;
const JPEG_QUALITY = 78;
/** 链接本身已带签名时效; 缩略图内容不变, 缓存一周足够减少重复生成 */
const CACHE_CONTROL = 'public, max-age=604800';
/**
 * 同时解码的原图上限。
 *
 * 首屏 20 张会并发请求缩略图, 每张都在主线程完整解码 (4MP PNG 约 16MB 位图,
 * 40MP 上限时可达 160MB)。不设限时一次打开素材库就能把内存顶到 GB 级。
 * 排队的请求只是慢一点, 生成结果仍会落盘复用。
 */
const MAX_CONCURRENT = 2;

interface ThumbReply {
  body: Buffer;
}

function sizeParam(raw: unknown, fallback: number): number {
  const value = typeof raw === 'string' ? Number.parseInt(raw, 10) : Number.NaN;
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(Math.max(value, MIN_SIZE), MAX_SIZE);
}

export function createAssetThumbnailMiddleware(
  uploadsDir: string,
  /** 是否启用本地缩略图。关闭时直接放行，由静态服务返回原图。默认开启。 */
  enabled = true,
) {
  // 功能关闭：一律回落，后续静态服务返回原图（?w= 等参数被忽略）。
  // 这样无需改前端：前端照常请求 ?w=，后端只当原图返回。
  if (!enabled) {
    return function disabledAssetThumbnailMiddleware(
      _req: Request,
      _res: Response,
      next: NextFunction,
    ): void {
      next();
    };
  }
  const root = resolve(uploadsDir);
  const cacheRoot = join(root, '.thumbs');
  /** 同一张图同一尺寸并发请求时只解码一次 */
  const inflight = new Map<string, Promise<ThumbReply | null>>();
  /** 解码槽位: 超出 MAX_CONCURRENT 时排队, 防止首屏并发解码顶爆内存 */
  let active = 0;
  const waiters: (() => void)[] = [];
  const acquire = (): Promise<void> => {
    if (active < MAX_CONCURRENT) {
      active += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => waiters.push(resolve));
  };
  const release = (): void => {
    const next = waiters.shift();
    // 直接移交槽位 (active 不变), 避免释放与获取之间的空窗让并发短暂超限
    if (next) next();
    else active -= 1;
  };

  return function assetThumbnailMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ): void {
    if (req.method !== 'GET') return next();
    if (typeof req.query.w !== 'string') return next();

    const pathname = req.path || req.url.split('?')[0];
    if (!pathname.startsWith('/uploads/')) return next();
    const key = pathname.slice('/uploads/'.length);
    // 缩略图自身不再套缩略图 (避免 .thumbs 递归)
    if (!key || key.startsWith('.thumbs/')) return next();

    try {
      assertSafeKey(key);
    } catch {
      res.status(400).end('非法存储 key');
      return;
    }

    const w = sizeParam(req.query.w, DEFAULT_SIZE);
    const hasHeight = typeof req.query.h === 'string';
    const h = hasHeight ? sizeParam(req.query.h, w) : null;
    const cacheFile = join(cacheRoot, `${w}x${h ?? 'auto'}`, `${key}.jpg`);

    const serve = (body: Buffer) => {
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', CACHE_CONTROL);
      res.setHeader('Content-Length', String(body.byteLength));
      res.end(body);
    };

    void (async () => {
      const cached = await fsp.readFile(cacheFile).catch(() => null);
      if (cached) {
        serve(cached);
        return;
      }

      let job = inflight.get(cacheFile);
      if (!job) {
        job = generateLimited();
        inflight.set(cacheFile, job);
        job.then(
          () => inflight.delete(cacheFile),
          () => inflight.delete(cacheFile),
        );
      }
      const result = await job;
      // 不是可解码图片: 交给静态服务返回原文件
      if (!result) return next();
      serve(result.body);
    })().catch(() => next());

    async function generateLimited(): Promise<ThumbReply | null> {
      await acquire();
      try {
        return await generate();
      } finally {
        release();
      }
    }

    /**
     * 读原图 → 裁切或等比缩放 → 编码 JPEG → 落盘缓存。
     * 透明图先铺白底再合 JPEG, 否则 alpha 会被编码成黑底。
     */
    async function generate(): Promise<ThumbReply | null> {
      try {
        const source = await fsp.readFile(join(root, key));

        const mime = detectImageMime(source);
        if (!mime) return null;
        const dims = readImageDimensions(source, mime);
        // 解码炸弹防护: 与上传侧同一像素上限, 超限不解码
        if (!dims || dims.width * dims.height > maxUploadPixels()) return null;

        const image = await Jimp.read(source);
        if (h === null) {
          const target = widthOnlyDimensions(dims.width, dims.height, w, MAX_SIZE);
          image.resize(target);
        } else {
          image.cover({ w, h });
        }

        let body: Buffer;
        if (image.hasAlpha()) {
          const canvas = new Jimp({
            width: image.bitmap.width,
            height: image.bitmap.height,
            color: 0xffffffff,
          });
          canvas.composite(image, 0, 0);
          body = await canvas.getBuffer(JimpMime.jpeg, { quality: JPEG_QUALITY });
        } else {
          body = await image.getBuffer(JimpMime.jpeg, { quality: JPEG_QUALITY });
        }

        // 缓存写失败不影响本次响应 (例如只读部署)
        await fsp.mkdir(dirname(cacheFile), { recursive: true }).catch(() => undefined);
        await fsp.writeFile(cacheFile, body).catch(() => undefined);
        return { body };
      } catch {
        return null;
      }
    }
  };
}

/** 只限制宽度时保持比例；极端长图额外限制高度，避免生成超大位图。 */
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
