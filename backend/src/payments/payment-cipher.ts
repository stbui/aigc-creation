import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

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

@Injectable()
export class PaymentCipher {
  private readonly log = new Logger(PaymentCipher.name);
  private key: Buffer | null = null;

  constructor(private readonly config: ConfigService) {}

  encrypt(plain: string): string {
    const value = String(plain ?? '');
    if (value === '') return '';
    if (value.startsWith(CIPHER_PREFIX)) return value;
    const nonce = randomBytes(NONCE_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.requireKey(), nonce);
    const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    const payload = Buffer.concat([nonce, ciphertext, cipher.getAuthTag()]);
    return CIPHER_PREFIX + payload.toString('base64url').replace(/=+$/, '');
  }

  decrypt(ciphertext: string): string {
    const value = String(ciphertext ?? '');
    if (value === '') return '';
    if (!value.startsWith(CIPHER_PREFIX)) return value;
    const payload = Buffer.from(value.slice(CIPHER_PREFIX.length), 'base64url');
    if (payload.length <= NONCE_BYTES + TAG_BYTES) throw new Error('支付配置密文长度无效');
    const nonce = payload.subarray(0, NONCE_BYTES);
    const tag = payload.subarray(payload.length - TAG_BYTES);
    const body = payload.subarray(NONCE_BYTES, payload.length - TAG_BYTES);
    const decipher = createDecipheriv('aes-256-gcm', this.requireKey(), nonce);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
  }

  private requireKey(): Buffer {
    if (this.key) return this.key;
    const configured = String(process.env.PAYMENT_SECRET_KEY ?? '').trim();
    if (configured) {
      const decoded = Buffer.from(configured, 'base64');
      if (decoded.length !== KEY_BYTES) {
        throw new Error('PAYMENT_SECRET_KEY 必须是 base64 编码的 32 字节密钥');
      }
      this.key = decoded;
      return this.key;
    }
    this.key = this.loadOrCreateFileKey();
    return this.key;
  }

  private loadOrCreateFileKey(): Buffer {
    const uploadDir = resolve(this.config.get<string>('path.uploads') ?? 'uploads');
    const keyPath = join(dirname(uploadDir), 'data', '.payment-secret-key');
    try {
      if (existsSync(keyPath)) {
        const data = readFileSync(keyPath);
        if (data.length === KEY_BYTES) return data;
        throw new Error(`支付配置加密密钥长度无效：${keyPath}`);
      }
      mkdirSync(dirname(keyPath), { recursive: true });
      const key = randomBytes(KEY_BYTES);
      writeFileSync(keyPath, key, { mode: 0o600 });
      this.log.warn(`未配置 PAYMENT_SECRET_KEY，已生成开发用密钥：${keyPath}（生产请显式配置）`);
      return key;
    } catch (error) {
      throw new Error(`读取支付配置加密密钥失败：${(error as Error).message}`);
    }
  }
}
