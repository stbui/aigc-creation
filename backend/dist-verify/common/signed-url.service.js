"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SignedUrlService = void 0;
exports.assetKeyOf = assetKeyOf;
exports.signAssetUrl = signAssetUrl;
exports.verifyAssetUrl = verifyAssetUrl;
/**
 * 素材签名 URL。
 *
 * 背景
 * ----
 * `/uploads/<key>` 由 Express 静态中间件直出 —— 只要猜到路径，任何人都能拿走
 * 别人的生成结果。key 里有随机段（`buildKey` 拼了时间与随机串），但这只是
 * 「难猜」，不是「有权限」。
 *
 * 打开 `ASSET_SIGNING_SECRET` 后，静态资源要求带 `exp`（过期时刻）+ `sig`
 * （HMAC-SHA256）。签名串是 `<key>|<exp>[|<uid>]`：
 *   · `key` 绑定对象，换文件不通用；
 *   · `exp` 限时，链接被转发出去也只在窗口内有效；
 *   · `uid`（可选）绑定用户，便于排障时知道是谁拿走的链接。
 *
 * **默认关闭**：`ASSET_SIGNING_SECRET` 为空时 `/uploads/*` 保持公开，
 * 与改造前行为完全一致。这不是偷懒 —— 打开后所有历史链接、外部模型网关
 * 拉参考图、既有冒烟都会受影响，必须是显式决策。
 *
 * 打开后的兼容策略
 * --------------
 * 接口同时返回 `sourceUrl`（不带签名，供服务端内部使用，如网关回传参考图）
 * 与 `signedUrl`（带签名，供 `<img>` 使用）。前端经 `assetSrc()` 优先取
 * `signedUrl`，取不到时回落到 `sourceUrl`。
 */
const node_crypto_1 = require("node:crypto");
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const DEFAULT_TTL_SEC = 6 * 60 * 60;
function hmac(secret, payload) {
    return (0, node_crypto_1.createHmac)('sha256', secret).update(payload).digest('base64url');
}
/**
 * 从 `/uploads/a/b.png` 或 `https://host/uploads/a/b.png` 里剥出 key。
 *
 * 绝对 URL 只在**它确实指向 /uploads** 时才剥 —— 云存储（OSS/MinIO）的地址
 * 自带签名且路径形态不同，原样返回，由调用方判定不可签。
 */
function assetKeyOf(urlOrKey) {
    if (!urlOrKey)
        return '';
    const noQuery = urlOrKey.split('?')[0];
    if (noQuery.startsWith('/uploads/'))
        return noQuery.slice('/uploads/'.length);
    if (/^https?:\/\//i.test(noQuery)) {
        const at = noQuery.indexOf('/uploads/');
        if (at >= 0)
            return noQuery.slice(at + '/uploads/'.length);
    }
    return noQuery;
}
function signAssetUrl(secret, keyOrUrl, options = {}) {
    const key = assetKeyOf(keyOrUrl);
    const exp = Math.floor((options.now ?? Date.now()) / 1000) + (options.expiresInSec ?? DEFAULT_TTL_SEC);
    const payload = options.userId ? `${key}|${exp}|${options.userId}` : `${key}|${exp}`;
    const sig = hmac(secret, payload);
    const query = new URLSearchParams({ exp: String(exp), sig });
    if (options.userId)
        query.set('uid', options.userId);
    // 云端 URL（OSS/MinIO）自带签名，原样返回；本函数的返回只针对站内 /uploads
    const base = `/uploads/${key}`;
    return `${base}?${query.toString()}`;
}
function verifyAssetUrl(secret, keyOrUrl, query, now = Date.now()) {
    const key = assetKeyOf(keyOrUrl);
    const exp = Number(query.exp);
    if (!query.exp || !query.sig || !Number.isFinite(exp))
        return { ok: false, reason: 'missing' };
    if (exp * 1000 < now)
        return { ok: false, reason: 'expired' };
    const payload = query.uid ? `${key}|${exp}|${query.uid}` : `${key}|${exp}`;
    const expected = Buffer.from(hmac(secret, payload));
    const actual = Buffer.from(String(query.sig));
    // 长度不同时 timingSafeEqual 会抛错，必须先比长度
    if (expected.length !== actual.length)
        return { ok: false, reason: 'bad-signature' };
    return (0, node_crypto_1.timingSafeEqual)(expected, actual) ? { ok: true } : { ok: false, reason: 'bad-signature' };
}
let SignedUrlService = class SignedUrlService {
    constructor(config) {
        this.secret = (config.get('asset.signingSecret') ?? '').trim();
    }
    /**
     * 展示用地址：开启签名时返回签名 URL，否则**原样返回**。
     *
     * 与 `sign()` 的区别是「不为空就一定有值」—— 用于只有展示用途的字段
     * （后台缩略图、数据中心的最近任务），这些地方不该再多一个 `signedUrl`
     * 让前端做二选一。
     */
    displayUrl(url, options = {}) {
        if (!url)
            return null;
        return this.sign(url, options) ?? url;
    }
    /** 是否开启签名校验。关闭时 `signedUrl` 返回 null，前端回落到 sourceUrl */
    get enabled() {
        return this.secret.length > 0;
    }
    /**
     * 为站内 /uploads 路径生成签名 URL。
     * 未开启签名、或传入的是外部绝对 URL（云端存储）时返回 null。
     */
    sign(keyOrUrl, options = {}) {
        if (!this.enabled || !keyOrUrl)
            return null;
        if (!keyOrUrl.startsWith('/uploads/'))
            return null;
        return signAssetUrl(this.secret, keyOrUrl, options);
    }
};
exports.SignedUrlService = SignedUrlService;
exports.SignedUrlService = SignedUrlService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], SignedUrlService);
//# sourceMappingURL=signed-url.service.js.map