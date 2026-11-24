import type { StorageObject, StorageProvider } from './storage.contract';
import { probeFailureMessage, verifyWriteProbe } from './storage.probe';
import { assertSafeKey, maskSecret, publicObjectUrl } from './storage.utils';

export interface MinioProviderConfig {
  endPoint: string;
  port: number;
  useSSL: boolean;
  accessKey: string;
  secretKey: string;
  bucket: string;
  /** S3 区域；MinIO 默认 us-east-1，云厂商兼容服务需按控制台填写 */
  region?: string;
  /** CDN / 自定义公开域名：配置后预览走直读，不签名 */
  publicBaseUrl?: string;
  /** 预签名有效期（秒）；MinIO SDK 默认 7 天 */
  urlExpiresSeconds?: number;
  /** 桶不存在时是否自动创建（仅私有部署的 MinIO 适用） */
  autoCreateBucket?: boolean;
}

/** MinIO（S3 兼容）后端。 */
export class MinioStorageProvider implements StorageProvider {
  readonly backend = 'minio' as const;
  private client: any;
  private bucket: string;

  constructor(
    private readonly cfg: MinioProviderConfig,
    /** 注入已有 client（单测 / 复用连接池）；不传才按需 require SDK */
    client?: unknown,
  ) {
    this.bucket = cfg.bucket;
    if (client !== undefined) {
      this.client = client;
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Client } = require('minio');
    this.client = new Client({
      endPoint: cfg.endPoint,
      port: cfg.port,
      useSSL: cfg.useSSL,
      accessKey: cfg.accessKey,
      secretKey: cfg.secretKey,
      ...(cfg.region ? { region: cfg.region } : {}),
    });
  }

  private base(): string {
    return `${this.cfg.useSSL ? 'https' : 'http'}://${this.cfg.endPoint}:${this.cfg.port}/${this.bucket}`;
  }

  async url(key: string): Promise<string> {
    assertSafeKey(key);
    if (this.cfg.publicBaseUrl) return publicObjectUrl(this.cfg.publicBaseUrl, key);
    const seconds = this.cfg.urlExpiresSeconds;
    // presignedGetObject 默认 7 天过期；配置了有效期就按配置签发
    return seconds
      ? this.client.presignedGetObject(this.bucket, key, seconds)
      : this.client.presignedGetObject(this.bucket, key);
  }

  async put(key: string, data: Buffer, contentType: string): Promise<StorageObject> {
    assertSafeKey(key);
    await this.client.putObject(this.bucket, key, data, data.byteLength, {
      'Content-Type': contentType,
    });
    return { key, sizeBytes: data.byteLength, contentType };
  }

  async get(key: string): Promise<Buffer> {
    assertSafeKey(key);
    const stream = await this.client.getObject(this.bucket, key);
    const chunks: Buffer[] = [];
    for await (const c of stream) chunks.push(c as Buffer);
    return Buffer.concat(chunks);
  }

  async delete(key: string): Promise<void> {
    assertSafeKey(key);
    await this.client.removeObject(this.bucket, key).catch(() => undefined);
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.statObject(this.bucket, key);
      return true;
    } catch {
      return false;
    }
  }

  async probe(opts?: { verifyWrite?: boolean }) {
    const t0 = Date.now();
    try {
      const ok = await this.client.bucketExists(this.bucket);
      if (!ok) {
        if (!this.cfg.autoCreateBucket) {
          return { ok: false, message: `bucket 不存在: ${this.bucket}（可在配置中开启自动创建）` };
        }
        try {
          await this.client.makeBucket(this.bucket, this.cfg.region || 'us-east-1');
        } catch (e) {
          return { ok: false, message: `bucket 不存在且创建失败: ${this.bucket} · ${(e as Error).message}` };
        }
      }
      const base = `连通正常 · ${this.base()}`;
      if (!opts?.verifyWrite) {
        return { ok: true, message: `${base}（只读探测）`, latencyMs: Date.now() - t0 };
      }
      const detail = await verifyWriteProbe({
        put: (k, d, ct) => this.put(k, d, ct),
        get: (k) => this.get(k),
        remove: (k) => this.client.removeObject(this.bucket, k),
      });
      return {
        ok: true,
        message: `${base} · ${detail}${this.cfg.publicBaseUrl ? ` · 公开域名 ${this.cfg.publicBaseUrl}` : ''}`,
        latencyMs: Date.now() - t0,
      };
    } catch (e) {
      return {
        ok: false,
        message: `连通失败: ${probeFailureMessage(e)}（Endpoint=${this.cfg.endPoint}:${this.cfg.port} Bucket=${this.bucket}）`,
      };
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