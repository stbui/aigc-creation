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
var PaymentCipher_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.PaymentCipher = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const node_crypto_1 = require("node:crypto");
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
/**
 * 支付配置加密（AES-256-GCM）。
 *
 * **刻意不复用 `MODEL_SECRET_KEY`**：模型渠道密钥轮换是很常见的运维动作，
 * 而支付配置密文一旦无法解密，所有「已发出但未回调」的订单将永久验签失败。
 * 两条业务线的密钥生命周期必须解耦。
 *
 * 密钥来源：
 * 1. `PAYMENT_SECRET_KEY`（base64 编码的 32 字节）—— 生产必须显式配置；
 * 2. 未配置时在 `<UPLOAD_DIR>/../data/.payment-secret-key` 生成并持久化（开发用）。
 *
 * 格式：`enc:v1:<base64url(nonce || ciphertext || tag)>`，与 SecretCipher 保持一致，
 * 便于人工排查时用同一套工具解密。
 */
const CIPHER_PREFIX = 'enc:v1:';
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;
let PaymentCipher = PaymentCipher_1 = class PaymentCipher {
    constructor(config) {
        this.config = config;
        this.log = new common_1.Logger(PaymentCipher_1.name);
        this.key = null;
    }
    encrypt(plain) {
        const value = String(plain ?? '');
        if (value === '')
            return '';
        if (value.startsWith(CIPHER_PREFIX))
            return value;
        const nonce = (0, node_crypto_1.randomBytes)(NONCE_BYTES);
        const cipher = (0, node_crypto_1.createCipheriv)('aes-256-gcm', this.requireKey(), nonce);
        const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
        const payload = Buffer.concat([nonce, ciphertext, cipher.getAuthTag()]);
        return CIPHER_PREFIX + payload.toString('base64url').replace(/=+$/, '');
    }
    decrypt(ciphertext) {
        const value = String(ciphertext ?? '');
        if (value === '')
            return '';
        if (!value.startsWith(CIPHER_PREFIX))
            return value;
        const payload = Buffer.from(value.slice(CIPHER_PREFIX.length), 'base64url');
        if (payload.length <= NONCE_BYTES + TAG_BYTES)
            throw new Error('支付配置密文长度无效');
        const nonce = payload.subarray(0, NONCE_BYTES);
        const tag = payload.subarray(payload.length - TAG_BYTES);
        const body = payload.subarray(NONCE_BYTES, payload.length - TAG_BYTES);
        const decipher = (0, node_crypto_1.createDecipheriv)('aes-256-gcm', this.requireKey(), nonce);
        decipher.setAuthTag(tag);
        return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
    }
    requireKey() {
        if (this.key)
            return this.key;
        const configured = String(process.env.PAYMENT_SECRET_KEY ?? '').trim();
        if (configured) {
            const decoded = Buffer.from(configured, 'base64');
            if (decoded.length !== KEY_BYTES) {
                throw new Error('PAYMENT_SECRET_KEY 必须是 base64 编码的 32 字节密钥');
            }
            this.key = decoded;
            return this.key;
        }
        if (process.env.NODE_ENV === 'production') {
            throw new Error('生产环境必须配置 PAYMENT_SECRET_KEY（base64 编码的 32 字节密钥）');
        }
        this.key = this.loadOrCreateFileKey();
        return this.key;
    }
    loadOrCreateFileKey() {
        const uploadDir = (0, node_path_1.resolve)(this.config.get('path.uploads') ?? 'uploads');
        const keyPath = (0, node_path_1.join)((0, node_path_1.dirname)(uploadDir), 'data', '.payment-secret-key');
        try {
            if ((0, node_fs_1.existsSync)(keyPath)) {
                const data = (0, node_fs_1.readFileSync)(keyPath);
                if (data.length === KEY_BYTES)
                    return data;
                throw new Error(`支付配置加密密钥长度无效：${keyPath}`);
            }
            (0, node_fs_1.mkdirSync)((0, node_path_1.dirname)(keyPath), { recursive: true });
            const key = (0, node_crypto_1.randomBytes)(KEY_BYTES);
            (0, node_fs_1.writeFileSync)(keyPath, key, { mode: 0o600 });
            this.log.warn(`未配置 PAYMENT_SECRET_KEY，已生成开发用密钥：${keyPath}（生产请显式配置）`);
            return key;
        }
        catch (error) {
            throw new Error(`读取支付配置加密密钥失败：${error.message}`);
        }
    }
};
exports.PaymentCipher = PaymentCipher;
exports.PaymentCipher = PaymentCipher = PaymentCipher_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], PaymentCipher);
//# sourceMappingURL=payment-cipher.js.map