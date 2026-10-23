/**
 * `/uploads/*` 签名校验中间件。
 *
 * 必须注册在 `useStaticAssets` **之前**：静态中间件一旦命中就直接响应，
 * 后面的中间件根本不会执行 —— 注册顺序反了等于没校验。
 *
 * secret 为空时直接放行，不改变默认公开行为（见 signed-url.service.ts 的说明）。
 */
import type { NextFunction, Request, Response } from 'express';
import { verifyAssetUrl } from './signed-url.service';

const REASON_TEXT: Record<string, string> = {
  missing: '缺少访问签名',
  expired: '链接已过期，请刷新页面重新获取',
  'bad-signature': '签名校验失败',
};

export function createSignedAssetMiddleware(secret: string) {
  const enabled = secret.trim().length > 0;

  return function signedAssetMiddleware(req: Request, res: Response, next: NextFunction): void {
    if (!enabled) return next();
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();

    const path = req.path || req.url.split('?')[0];
    if (!path.startsWith('/uploads/')) return next();

    const key = path.slice('/uploads/'.length);
    const result = verifyAssetUrl(enabled ? secret : '', key, {
      exp: typeof req.query.exp === 'string' ? req.query.exp : undefined,
      sig: typeof req.query.sig === 'string' ? req.query.sig : undefined,
      uid: typeof req.query.uid === 'string' ? req.query.uid : undefined,
    });

    if (result.ok) return next();

    const status = result.reason === 'expired' ? 410 : 403;
    res.status(status).json({
      code: status === 410 ? 40104 : 40103,
      data: null,
      message: REASON_TEXT[result.reason ?? 'missing'] ?? '无权访问该资源',
    });
  };
}
