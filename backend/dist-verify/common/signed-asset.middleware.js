"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createSignedAssetMiddleware = createSignedAssetMiddleware;
const signed_url_service_1 = require("./signed-url.service");
const REASON_TEXT = {
    missing: '缺少访问签名',
    expired: '链接已过期，请刷新页面重新获取',
    'bad-signature': '签名校验失败',
};
function createSignedAssetMiddleware(secret) {
    const enabled = secret.trim().length > 0;
    return function signedAssetMiddleware(req, res, next) {
        if (!enabled)
            return next();
        if (req.method !== 'GET' && req.method !== 'HEAD')
            return next();
        const path = req.path || req.url.split('?')[0];
        if (!path.startsWith('/uploads/'))
            return next();
        const key = path.slice('/uploads/'.length);
        const result = (0, signed_url_service_1.verifyAssetUrl)(enabled ? secret : '', key, {
            exp: typeof req.query.exp === 'string' ? req.query.exp : undefined,
            sig: typeof req.query.sig === 'string' ? req.query.sig : undefined,
            uid: typeof req.query.uid === 'string' ? req.query.uid : undefined,
        });
        if (result.ok)
            return next();
        const status = result.reason === 'expired' ? 410 : 403;
        res.status(status).json({
            code: status === 410 ? 40104 : 40103,
            data: null,
            message: REASON_TEXT[result.reason ?? 'missing'] ?? '无权访问该资源',
        });
    };
}
//# sourceMappingURL=signed-asset.middleware.js.map