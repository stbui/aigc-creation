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

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const CIPHER_PREFIX = 'enc:v1:';
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

@Injectable()
export class SecretCipher {
  private readonly log = new Logger(SecretCipher.name);
  private key: Buffer | null = null;

  constructor(private readonly config: ConfigService) {}

  /** 加密。空串原样返回 —— 「未设置」与「密文」必须可区分 */
  encrypt(plain: string): string {
    const value = String(plain ?? '');
    if (value === '') return '';
    if (value.startsWith(CIPHER_PREFIX)) return value;
    const key = this.requireKey();
    const nonce = randomBytes(NONCE_BYTES);
    const cipher = createCipheriv('aes-256-gcm', key, nonce);
    const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    const payload = Buffer.concat([nonce, ciphertext, cipher.getAuthTag()]);
    return CIPHER_PREFIX + payload.toString('base64url').replace(/=+$/, '');
  }

  /** 解密。无前缀视为历史明文原样返回；密文损坏直接抛错，不静默当空 */
  decrypt(ciphertext: string): string {
    const value = String(ciphertext ?? '');
    if (value === '') return '';
    if (!value.startsWith(CIPHER_PREFIX)) return value;
    const base64 = value.slice(CIPHER_PREFIX.length);
    const payload = Buffer.from(base64, 'base64url');
    if (payload.length <= NONCE_BYTES + TAG_BYTES) {
      throw new Error('渠道凭证密文长度无效');
    }
    const nonce = payload.subarray(0, NONCE_BYTES);
    const tag = payload.subarray(payload.length - TAG_BYTES);
    const body = payload.subarray(NONCE_BYTES, payload.length - TAG_BYTES);
    const decipher = createDecipheriv('aes-256-gcm', this.requireKey(), nonce);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
  }

  /** 是否已是密文 */
  isEncrypted(value: string): boolean {
    return String(value ?? '').startsWith(CIPHER_PREFIX);
  }

  /** 展示用掩码：只保留后 4 位，长度不足以掩码时返回固定占位 */
  mask(plain: string): string {
    const value = String(plain ?? '');
    if (!value) return '';
    if (value.length <= 8) return '••••••••';
    return `${'•'.repeat(Math.min(12, value.length - 4))}${value.slice(-4)}`;
  }

  private requireKey(): Buffer {
    if (this.key) return this.key;
    const configured = String(this.config.get<string>('model.secretKey') ?? '').trim();
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

  private loadOrCreateFileKey(): Buffer {
    const uploadDir = resolve(this.config.get<string>('path.uploads') ?? 'uploads');
    const keyPath = join(dirname(uploadDir), 'data', '.model-secret-key');
    try {
      if (existsSync(keyPath)) {
        const data = readFileSync(keyPath);
        if (data.length === KEY_BYTES) return data;
        throw new Error(`渠道加密密钥长度无效：${keyPath}`);
      }
      mkdirSync(dirname(keyPath), { recursive: true });
      const key = randomBytes(KEY_BYTES);
      writeFileSync(keyPath, key, { mode: 0o600 });
      this.log.warn(`未配置 MODEL_SECRET_KEY，已生成开发用密钥：${keyPath}（生产请显式配置）`);
      return key;
    } catch (error) {
      throw new Error(`读取渠道加密密钥失败：${(error as Error).message}`);
    }
  }
}
