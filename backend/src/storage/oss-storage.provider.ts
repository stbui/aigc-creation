import type { StorageObject, StorageProvider } from './storage.contract';
import { probeFailureMessage, verifyWriteProbe } from './storage.probe';
import { assertSafeKey, maskSecret, publicObjectUrl } from './storage.utils';

export interface OssProviderConfig {
  region: string;
  bucket: string;
  accessKeyId: string;
  accessKeySecret: string;
  /** 自定义 Endpoint（公有云可留空，由 SDK 按 region 推导） */
  endpoint?: string;
  /** STS 临时凭证；与长期 AK 二选一 */
  sessionToken?: string;
  /** CDN / 自定义公开域名：配置后页面预览走直读，不签名 */
  publicBaseUrl?: string;
  /** 私有桶签名有效期（秒），默认 3600 */
  urlExpiresSeconds?: number;
}

/** 阿里云 OSS 后端。 */
export class OssStorageProvider implements StorageProvider {
  readonly backend = 'oss' as const;
  private client: any; // ali-oss 实例, 类型随 SDK 版本变化, 用 any 隔离

  constructor(
    private readonly cfg: OssProviderConfig,
    /** 注入已有 client（单测 / 复用连接池）；不传才按需 require SDK */
    client?: unknown,
  ) {
    if (client !== undefined) {
      this.client = client;
      return;
    }
    // 按需 require: 未配置 OSS 时不加载 SDK, 本地开发零依赖
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const OSS = require('ali-oss');
    this.client = new OSS({
      region: cfg.region,
      bucket: cfg.bucket,
      accessKeyId: cfg.accessKeyId,
      accessKeySecret: cfg.accessKeySecret,
      ...(cfg.sessionToken ? { stsToken: cfg.sessionToken } : {}),
      ...(cfg.endpoint ? { endpoint: cfg.endpoint } : {}),
    });
  }

  /**
   * 预览地址：配置了 CDN / 公开域名就走直读，否则签名。
   *
   * 私有桶的签名 URL 会过期，所以只用于页面即时预览、不入库；
   * 公开域名由 CDN 自己处理鉴权，签名参数反而会让缓存失效。
   */
  async url(key: string): Promise<string> {
    assertSafeKey(key);
    if (this.cfg.publicBaseUrl) return publicObjectUrl(this.cfg.publicBaseUrl, key);
    return this.client.signatureUrl(key, { expires: this.cfg.urlExpiresSeconds ?? 3600 });
  }

  async put(key: string, data: Buffer, contentType: string): Promise<StorageObject> {
    assertSafeKey(key);
    await this.client.put(key, data, { headers: { 'Content-Type': contentType } });
    // ⚠ 不能用上传响应的 content-length: 那是 HTTP 响应体长度, 不是对象大小,
    // 写进 Asset.sizeBytes 会把容量统计彻底带偏。以实际写入字节数为准。
    return { key, sizeBytes: data.byteLength, contentType };
  }

  async get(key: string): Promise<Buffer> {
    assertSafeKey(key);
    const res = await this.client.get(key);
    return Buffer.isBuffer(res.content) ? res.content : Buffer.from(res.content);
  }

  async delete(key: string): Promise<void> {
    assertSafeKey(key);
    await this.client.delete(key).catch(() => undefined);
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.head(key);
      return true;
    } catch {
      return false;
    }
  }

  async probe(opts?: { verifyWrite?: boolean }) {
    const t0 = Date.now();
    try {
      // list 一次即证明凭据有效且 bucket 可达, 不产生写入
      await this.client.list({ 'max-keys': 1 });
      const base = `连通正常 · ${this.cfg.bucket} @ ${this.cfg.region}`;
      if (!opts?.verifyWrite) {
        return { ok: true, message: `${base}（只读探测）`, latencyMs: Date.now() - t0 };
      }
      const detail = await verifyWriteProbe({
        put: (k, d, ct) => this.put(k, d, ct),
        get: (k) => this.get(k),
        remove: (k) => this.client.delete(k),
      });
      return {
        ok: true,
        message: `${base} · ${detail}${this.cfg.publicBaseUrl ? ` · 公开域名 ${this.cfg.publicBaseUrl}` : ''}`,
        latencyMs: Date.now() - t0,
      };
    } catch (e) {
      return {
        ok: false,
        message: `连通失败: ${probeFailureMessage(e)}（Bucket=${this.cfg.bucket} Region=${this.cfg.region}）`,
      };
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