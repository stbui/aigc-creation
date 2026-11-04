"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createAssetThumbnailMiddleware = createAssetThumbnailMiddleware;
/**
 * `/uploads/*` 素材缩略图中间件。
 *
 * ## 为什么需要
 *
 * 素材库是纯图网格, 卡片实际只有 200 多像素, 但接口给的是原图 —— 本机实测
 * 首屏 20 张合计约 29MB (单张最大 3.4MB)。素材一多, 图片加载和内存都会被
 * 原图拖垮。这里按 URL 上的 `w` / `h` 生成方形 JPEG 缩略图并落盘缓存,
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
 * 缓存目录在 `<UPLOAD_DIR>/.thumbs/<w>x<h>/<key>.jpg`。素材 key 带随机段且
 * 从不原地覆盖, 因此缓存文件不会过期; 删除素材时 `AssetsService.remove()`
 * 会一并清理所有尺寸变体。
 */
const fs_1 = require("fs");
const path_1 = require("path");
const jimp_1 = require("jimp");
const storage_provider_1 = require("../storage/storage.provider");
const image_validation_1 = require("./image-validation");
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
function sizeParam(raw, fallback) {
    const value = typeof raw === 'string' ? Number.parseInt(raw, 10) : Number.NaN;
    if (!Number.isFinite(value) || value <= 0)
        return fallback;
    return Math.min(Math.max(value, MIN_SIZE), MAX_SIZE);
}
function createAssetThumbnailMiddleware(uploadsDir) {
    const root = (0, path_1.resolve)(uploadsDir);
    const cacheRoot = (0, path_1.join)(root, '.thumbs');
    /** 同一张图同一尺寸并发请求时只解码一次 */
    const inflight = new Map();
    /** 解码槽位: 超出 MAX_CONCURRENT 时排队, 防止首屏并发解码顶爆内存 */
    let active = 0;
    const waiters = [];
    const acquire = () => {
        if (active < MAX_CONCURRENT) {
            active += 1;
            return Promise.resolve();
        }
        return new Promise((resolve) => waiters.push(resolve));
    };
    const release = () => {
        const next = waiters.shift();
        // 直接移交槽位 (active 不变), 避免释放与获取之间的空窗让并发短暂超限
        if (next)
            next();
        else
            active -= 1;
    };
    return function assetThumbnailMiddleware(req, res, next) {
        if (req.method !== 'GET')
            return next();
        if (typeof req.query.w !== 'string')
            return next();
        const pathname = req.path || req.url.split('?')[0];
        if (!pathname.startsWith('/uploads/'))
            return next();
        const key = pathname.slice('/uploads/'.length);
        // 缩略图自身不再套缩略图 (避免 .thumbs 递归)
        if (!key || key.startsWith('.thumbs/'))
            return next();
        try {
            (0, storage_provider_1.assertSafeKey)(key);
        }
        catch {
            res.status(400).end('非法存储 key');
            return;
        }
        const w = sizeParam(req.query.w, DEFAULT_SIZE);
        const h = sizeParam(req.query.h, w);
        const cacheFile = (0, path_1.join)(cacheRoot, `${w}x${h}`, `${key}.jpg`);
        const serve = (body) => {
            res.setHeader('Content-Type', 'image/jpeg');
            res.setHeader('Cache-Control', CACHE_CONTROL);
            res.setHeader('Content-Length', String(body.byteLength));
            res.end(body);
        };
        void (async () => {
            const cached = await fs_1.promises.readFile(cacheFile).catch(() => null);
            if (cached) {
                serve(cached);
                return;
            }
            let job = inflight.get(cacheFile);
            if (!job) {
                job = generateLimited();
                inflight.set(cacheFile, job);
                job.then(() => inflight.delete(cacheFile), () => inflight.delete(cacheFile));
            }
            const result = await job;
            // 不是可解码图片: 交给静态服务返回原文件
            if (!result)
                return next();
            serve(result.body);
        })().catch(() => next());
        async function generateLimited() {
            await acquire();
            try {
                return await generate();
            }
            finally {
                release();
            }
        }
        /**
         * 读原图 → 方形裁切 → 编码 JPEG → 落盘缓存。
         * 透明图先铺白底再合 JPEG, 否则 alpha 会被编码成黑底。
         */
        async function generate() {
            try {
                const source = await fs_1.promises.readFile((0, path_1.join)(root, key));
                const mime = (0, image_validation_1.detectImageMime)(source);
                if (!mime)
                    return null;
                const dims = (0, image_validation_1.readImageDimensions)(source, mime);
                // 解码炸弹防护: 与上传侧同一像素上限, 超限不解码
                if (!dims || dims.width * dims.height > (0, image_validation_1.maxUploadPixels)())
                    return null;
                const image = await jimp_1.Jimp.read(source);
                image.cover({ w, h });
                let body;
                if (image.hasAlpha()) {
                    const canvas = new jimp_1.Jimp({
                        width: image.bitmap.width,
                        height: image.bitmap.height,
                        color: 0xffffffff,
                    });
                    canvas.composite(image, 0, 0);
                    body = await canvas.getBuffer(jimp_1.JimpMime.jpeg, { quality: JPEG_QUALITY });
                }
                else {
                    body = await image.getBuffer(jimp_1.JimpMime.jpeg, { quality: JPEG_QUALITY });
                }
                // 缓存写失败不影响本次响应 (例如只读部署)
                await fs_1.promises.mkdir((0, path_1.dirname)(cacheFile), { recursive: true }).catch(() => undefined);
                await fs_1.promises.writeFile(cacheFile, body).catch(() => undefined);
                return { body };
            }
            catch {
                return null;
            }
        }
    };
}
//# sourceMappingURL=asset-thumbnail.middleware.js.map