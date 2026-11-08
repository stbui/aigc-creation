"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MinioStorageProvider = exports.OssStorageProvider = exports.LocalStorageProvider = exports.STORAGE_BACKENDS = void 0;
exports.isStorageBackend = isStorageBackend;
exports.assertSafeKey = assertSafeKey;
exports.maskSecret = maskSecret;
exports.maskBucket = maskBucket;
const fs_1 = require("fs");
const fs_2 = require("fs");
const path_1 = require("path");
/**
 * 存储后端抽象。
 *
 * 背景: 素材原先硬编码写本地磁盘 (assets.service.ts 的 toDiskPath 直接拼路径)。
 * 一旦要接 OSS / MinIO, 这个假设就崩了 —— 每个调用点都得改。
 * 这里把「存/取/删/探测」四个动作收敛到统一接口, 调用方只认接口不认实现。
 *
 * 设计要点:
 *   1. **云SDK 按需 require**: 配置未启用该后端时不加载对应 SDK。
 *      本地开发零云依赖, npm install 体积与启动时间都不受影响。
 *   2. **凭据只从环境变量读, 永不进 DB**: B-63 要求界面不可编辑凭据。
 *   3. **key 是唯一真相**: DB 存 storageKey (相对路径), 不存可变的完整 URL ——
 *      切换域名/CDN 后只需改配置, 不必刷库。
 */
/** 全部候选后端。顺序即后台展示顺序：本地优先，云端在后。 */
exports.STORAGE_BACKENDS = ['local', 'oss', 'minio'];
/** 收窄运行时字符串，避免各入口重复维护后端白名单。 */
function isStorageBackend(value) {
    return exports.STORAGE_BACKENDS.includes(value);
}
/**
 * 防目录穿越: key 只允许字母数字与 - _ /, 且不含 .. 与开头 /
 *
 * 非法 key 若拼进磁盘路径就是任意文件读写漏洞 —— 必须在入口拦死。
 */
function assertSafeKey(key) {
    if (!key || key.length > 512)
        throw new Error('非法存储 key');
    if (key.includes('..'))
        throw new Error('非法存储 key');
    if (key.startsWith('/') || key.includes('\\'))
        throw new Error('非法存储 key');
    if (!/^[A-Za-z0-9/_.-]+$/.test(key))
        throw new Error('非法存储 key');
}
// ─────────────────────────────────────────────────────────────────────
// 本地磁盘
// ─────────────────────────────────────────────────────────────────────
class LocalStorageProvider {
    constructor(root = (0, path_1.resolve)(process.cwd(), 'uploads'), publicPrefix = '/uploads') {
        this.root = root;
        this.publicPrefix = publicPrefix;
        this.backend = 'local';
    }
    abs(key) {
        assertSafeKey(key);
        const full = (0, path_1.resolve)(this.root, key);
        // 双保险: 即使 assertSafeKey 被绕过, 仍校验解析后路径在 root 内
        if (!full.startsWith(this.root + '/'))
            throw new Error('非法存储 key');
        return full;
    }
    async url(key) {
        return `${this.publicPrefix}/${key}`;
    }
    async put(key, data) {
        const full = this.abs(key);
        await fs_1.promises.mkdir((0, path_1.join)(full, '..'), { recursive: true });
        await fs_1.promises.writeFile(full, data);
        return { key, sizeBytes: data.byteLength, contentType: 'application/octet-stream' };
    }
    async get(key) {
        return fs_1.promises.readFile(this.abs(key));
    }
    async delete(key) {
        await fs_1.promises.unlink(this.abs(key)).catch(() => undefined);
    }
    async exists(key) {
        return (0, fs_2.existsSync)(this.abs(key));
    }
    async probe() {
        const t0 = Date.now();
        try {
            await fs_1.promises.mkdir(this.root, { recursive: true });
            // 实写一个探针文件再删 —— 只检查目录可访问不足以证明可写
            const probeKey = `.probe-${Date.now()}`;
            await this.put(probeKey, Buffer.from('ok'));
            await this.delete(probeKey);
            return { ok: true, message: `可读可写: ${this.root}`, latencyMs: Date.now() - t0 };
        }
        catch (e) {
            return { ok: false, message: `不可写: ${e.message}` };
        }
    }
    credentialStatus() {
        return { configured: true, endpoint: this.root };
    }
}
exports.LocalStorageProvider = LocalStorageProvider;
// ─────────────────────────────────────────────────────────────────────
// 阿里云 OSS
// ─────────────────────────────────────────────────────────────────────
/** 脱敏: 只保留末 4 位 */
function maskSecret(v) {
    if (!v)
        return undefined;
    return v.length <= 4 ? '****' : `****${v.slice(-4)}`;
}
class OssStorageProvider {
    constructor(cfg) {
        this.cfg = cfg;
        this.backend = 'oss';
        // 按需 require: 未配置 OSS 时不加载 SDK, 本地开发零依赖
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const OSS = require('ali-oss');
        this.client = new OSS({
            region: cfg.region,
            bucket: cfg.bucket,
            accessKeyId: cfg.accessKeyId,
            accessKeySecret: cfg.accessKeySecret,
            ...(cfg.endpoint ? { endpoint: cfg.endpoint } : {}),
        });
    }
    async url(key) {
        assertSafeKey(key);
        return this.client.signatureUrl(key, { expires: 3600 });
    }
    async put(key, data, contentType) {
        assertSafeKey(key);
        const res = await this.client.put(key, data, { headers: { 'Content-Type': contentType } });
        return {
            key,
            sizeBytes: Number(res.res?.headers?.['content-length'] ?? data.byteLength),
            contentType,
        };
    }
    async get(key) {
        assertSafeKey(key);
        const res = await this.client.get(key);
        return Buffer.isBuffer(res.content) ? res.content : Buffer.from(res.content);
    }
    async delete(key) {
        assertSafeKey(key);
        await this.client.delete(key).catch(() => undefined);
    }
    async exists(key) {
        try {
            await this.client.head(key);
            return true;
        }
        catch {
            return false;
        }
    }
    async probe() {
        const t0 = Date.now();
        try {
            // list 一次即证明凭据有效且 bucket 可达, 不产生写入
            await this.client.list({ 'max-keys': 1 });
            return {
                ok: true,
                message: `连通正常 · ${this.cfg.bucket} @ ${this.cfg.region}`,
                latencyMs: Date.now() - t0,
            };
        }
        catch (e) {
            return { ok: false, message: `连通失败: ${e.message}` };
        }
    }
    credentialStatus() {
        return {
            configured: true,
            masked: maskSecret(this.cfg.accessKeyId),
            endpoint: `${this.cfg.region}/${this.cfg.bucket}`,
        };
    }
}
exports.OssStorageProvider = OssStorageProvider;
// ─────────────────────────────────────────────────────────────────────
// MinIO (S3 兼容)
// ─────────────────────────────────────────────────────────────────────
class MinioStorageProvider {
    constructor(cfg) {
        this.cfg = cfg;
        this.backend = 'minio';
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { Client } = require('minio');
        this.client = new Client({
            endPoint: cfg.endPoint,
            port: cfg.port,
            useSSL: cfg.useSSL,
            accessKey: cfg.accessKey,
            secretKey: cfg.secretKey,
        });
        this.bucket = cfg.bucket;
    }
    base() {
        return `${this.cfg.useSSL ? 'https' : 'http'}://${this.cfg.endPoint}:${this.cfg.port}/${this.bucket}`;
    }
    async url(key) {
        assertSafeKey(key);
        // presignedGetObject 默认 7 天过期, 足够页面预览
        return this.client.presignedGetObject(this.bucket, key);
    }
    async put(key, data, contentType) {
        assertSafeKey(key);
        await this.client.putObject(this.bucket, key, data, data.byteLength, {
            'Content-Type': contentType,
        });
        return { key, sizeBytes: data.byteLength, contentType };
    }
    async get(key) {
        assertSafeKey(key);
        const stream = await this.client.getObject(this.bucket, key);
        const chunks = [];
        for await (const c of stream)
            chunks.push(c);
        return Buffer.concat(chunks);
    }
    async delete(key) {
        assertSafeKey(key);
        await this.client.removeObject(this.bucket, key).catch(() => undefined);
    }
    async exists(key) {
        try {
            await this.client.statObject(this.bucket, key);
            return true;
        }
        catch {
            return false;
        }
    }
    async probe() {
        const t0 = Date.now();
        try {
            const ok = await this.client.bucketExists(this.bucket);
            if (!ok)
                return { ok: false, message: `bucket 不存在: ${this.bucket}` };
            return {
                ok: true,
                message: `连通正常 · ${this.base()}`,
                latencyMs: Date.now() - t0,
            };
        }
        catch (e) {
            return { ok: false, message: `连通失败: ${e.message}` };
        }
    }
    credentialStatus() {
        return {
            configured: true,
            masked: maskSecret(this.cfg.accessKey),
            endpoint: this.base(),
        };
    }
}
exports.MinioStorageProvider = MinioStorageProvider;
/** 脱敏桶名单: 用于展示凭据是否配置 */
function maskBucket(v) {
    if (!v)
        return undefined;
    return maskSecret(v);
}
//# sourceMappingURL=storage.provider.js.map