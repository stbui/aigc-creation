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
 * 未带 `w`、不是图片 (视频素材)、解码失败时一律 `next()`,
 * 交给后面的静态服务返回原文件 —— 行为与改造前完全一致, 不会把素材变成 404。
 *
 * ## 注册顺序
 *
 * 必须在签名中间件**之后** (复用同一份访问校验)、`useStaticAssets` **之前**
 * (静态中间件命中即响应, 注册在后面就拿不到缩略图了)。
 *
 * ## 缓存与预热
 *
 * 缓存目录在 `<UPLOAD_DIR>/.thumbs/<w>x<h|auto>/<key>.jpg`。素材 key 带随机段且
 * 从不原地覆盖, 因此缓存文件不会过期; 删除素材时 `AssetsService.remove()`
 * 会一并清理所有尺寸变体。渲染逻辑与缓存路径见 `thumb-render.ts` ——
 * 写入侧（上传 / 产出落库）用同一套函数**预热**，让浏览时全部命中磁盘。
 */
import { promises as fsp } from 'fs';
import { join, resolve } from 'path';
import type { NextFunction, Request, Response } from 'express';
import { assertSafeKey } from '../storage/storage.provider';
import { renderThumbsFromBuffer, saveThumbCache, thumbCacheFile, type ThumbSpec } from './thumb-render';

const MIN_SIZE = 32;
const MAX_SIZE = 1280;
const DEFAULT_SIZE = 640;
/** 链接本身已带签名时效; 缩略图内容不变, 缓存一周足够减少重复生成 */
const CACHE_CONTROL = 'public, max-age=604800';
/**
 * 同时解码的原图上限。
 *
 * Jimp 解码是**同步**的纯 JS 计算：一张 9MP 照片约 1.0–1.3s，期间主线程被占满。
 * 故这里限制的是**内存峰值**（单张 4MP PNG 约 16MB 位图，40MP 上限时可达 160MB），
 * 不是吞吐 —— 串行解码时并发调高只会让内存叠加、总耗时不变（实测 2 并发比 1 并发
 * 更慢）。真正的吞吐优化在写入侧预热：见 `thumb-render.ts` 的 `warmThumbnails`。
 */
const MAX_CONCURRENT = 2;

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
  /** 同一张图同一尺寸并发请求时只解码一次 */
  const inflight = new Map<string, Promise<Buffer | null>>();
  /** 解码槽位: 超出 MAX_CONCURRENT 时排队, 防止并发解码顶爆内存 */
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
    const spec: ThumbSpec = { w, h };
    const cacheFile = thumbCacheFile(root, key, spec);

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
      const body = await job;
      // 不是可解码图片: 交给静态服务返回原文件
      if (!body) return next();
      serve(body);
    })().catch(() => next());

    async function generateLimited(): Promise<Buffer | null> {
      await acquire();
      try {
        return await generate();
      } finally {
        release();
      }
    }

    /**
     * 读原图 → 裁切或等比缩放 → 编码 JPEG → 落盘缓存。
     * 渲染细节 (含解码炸弹防护 / 透明底处理) 见 `thumb-render.ts`。
     */
    async function generate(): Promise<Buffer | null> {
      try {
        const source = await fsp.readFile(join(root, key));
        const [rendered] = await renderThumbsFromBuffer(source, [spec]);
        if (!rendered) return null;
        await saveThumbCache(cacheFile, rendered.body);
        return rendered.body;
      } catch {
        return null;
      }
    }
  };
}
