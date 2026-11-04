"use strict";
/**
 * 渠道凭证加密 —— 上游 API Key / SecretKey / 自定义请求头在库内只存密文。
 *
 * 算法与格式对齐 open-ai-canvas `settings.go`：AES-256-GCM，密文形如
 * `enc:v1:<base64(nonce || ciphertext || tag)>`，base64 用无填充变体。
 * 前缀存在是为了让「明文历史值」能与密文共存一轮：读到的值没有前缀就原样
 * 返回，后台保存时再统一加密 —— 不需要一次性停机迁移脚本。
 *
 * 密钥来源两选一：
 * 1. `MODEL_SECRET_KEY`（base64 编码的 32 字节）—— 生产必须显式配置；
 * 2. 未配置时在 `<UPLOAD_DIR>/../data/.model-secret-key` 生成并持久化。
 *    开发 / 测试用它，避免零配置启动失败；生产换了密钥等于全部凭证作废，
 *    因此根 `NOTICE` 与 `.env.example` 都标注为必配项。
 */
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var SecretCipher_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.SecretCipher = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const node_crypto_1 = require("node:crypto");
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const CIPHER_PREFIX = 'enc:v1:';
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;
let SecretCipher = SecretCipher_1 = class SecretCipher {
    constructor(config) {
        this.config = config;
        this.log = new common_1.Logger(SecretCipher_1.name);
        this.key = null;
    }
    /** 加密。空串原样返回 —— 「未设置」与「密文」必须可区分 */
    encrypt(plain) {
        const value = String(plain ?? '');
        if (value === '')
            return '';
        if (value.startsWith(CIPHER_PREFIX))
            return value;
        const key = this.requireKey();
        const nonce = (0, node_crypto_1.randomBytes)(NONCE_BYTES);
        const cipher = (0, node_crypto_1.createCipheriv)('aes-256-gcm', key, nonce);
        const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
        const payload = Buffer.concat([nonce, ciphertext, cipher.getAuthTag()]);
        return CIPHER_PREFIX + payload.toString('base64url').replace(/=+$/, '');
    }
    /** 解密。无前缀视为历史明文原样返回；密文损坏直接抛错，不静默当空 */
    decrypt(ciphertext) {
        const value = String(ciphertext ?? '');
        if (value === '')
            return '';
        if (!value.startsWith(CIPHER_PREFIX))
            return value;
        const base64 = value.slice(CIPHER_PREFIX.length);
        const payload = Buffer.from(base64, 'base64url');
        if (payload.length <= NONCE_BYTES + TAG_BYTES) {
            throw new Error('渠道凭证密文长度无效');
        }
        const nonce = payload.subarray(0, NONCE_BYTES);
        const tag = payload.subarray(payload.length - TAG_BYTES);
        const body = payload.subarray(NONCE_BYTES, payload.length - TAG_BYTES);
        const decipher = (0, node_crypto_1.createDecipheriv)('aes-256-gcm', this.requireKey(), nonce);
        decipher.setAuthTag(tag);
        return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
    }
    /** 是否已是密文 */
    isEncrypted(value) {
        return String(value ?? '').startsWith(CIPHER_PREFIX);
    }
    /** 展示用掩码：只保留后 4 位，长度不足以掩码时返回固定占位 */
    mask(plain) {
        const value = String(plain ?? '');
        if (!value)
            return '';
        if (value.length <= 8)
            return '••••••••';
        return `${'•'.repeat(Math.min(12, value.length - 4))}${value.slice(-4)}`;
    }
    requireKey() {
        if (this.key)
            return this.key;
        const configured = String(this.config.get('model.secretKey') ?? '').trim();
        if (configured) {
            const decoded = Buffer.from(configured, 'base64');
            if (decoded.length !== KEY_BYTES) {
                throw new Error('MODEL_SECRET_KEY 必须是 base64 编码的 32 字节密钥');
            }
            this.key = decoded;
            return this.key;
        }
        this.key = this.loadOrCreateFileKey();
        return this.key;
    }
    loadOrCreateFileKey() {
        const uploadDir = (0, node_path_1.resolve)(this.config.get('path.uploads') ?? 'uploads');
        const keyPath = (0, node_path_1.join)((0, node_path_1.dirname)(uploadDir), 'data', '.model-secret-key');
        try {
            if ((0, node_fs_1.existsSync)(keyPath))
                return this.readKeyFile(keyPath);
            (0, node_fs_1.mkdirSync)((0, node_path_1.dirname)(keyPath), { recursive: true });
            // 原子发布：先写同目录临时文件，再用 link 抢占目标名。两个进程同时首启时
            // 只有一个 link 成功，另一个会拿到 EEXIST 并读取赢家写好的完整密钥 ——
            // 绝不能直接 writeFileSync 覆盖，否则两边各缓存一把钥匙，互相解不开凭证。
            const tempPath = `${keyPath}.${process.pid}.${(0, node_crypto_1.randomBytes)(6).toString('hex')}.tmp`;
            const key = (0, node_crypto_1.randomBytes)(KEY_BYTES);
            (0, node_fs_1.writeFileSync)(tempPath, key, { mode: 0o600, flag: 'wx' });
            try {
                (0, node_fs_1.linkSync)(tempPath, keyPath);
                this.log.warn(`未配置 MODEL_SECRET_KEY，已生成开发用密钥：${keyPath}（生产请显式配置）`);
                return key;
            }
            catch (error) {
                if (error.code === 'EEXIST') {
                    return this.readKeyFile(keyPath);
                }
                throw error;
            }
            finally {
                try {
                    (0, node_fs_1.unlinkSync)(tempPath);
                }
                catch {
                    // 临时文件清理失败不影响密钥本身
                }
            }
        }
        catch (error) {
            throw new Error(`读取渠道加密密钥失败：${error.message}`);
        }
    }
    readKeyFile(keyPath) {
        const data = (0, node_fs_1.readFileSync)(keyPath);
        if (data.length !== KEY_BYTES)
            throw new Error(`渠道加密密钥长度无效：${keyPath}`);
        return data;
    }
};
exports.SecretCipher = SecretCipher;
exports.SecretCipher = SecretCipher = SecretCipher_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], SecretCipher);
//# sourceMappingURL=secret-cipher.js.map