import { promises as fs } from 'fs';
import { existsSync } from 'fs';
import { join, resolve } from 'path';

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

export type StorageBackend = 'local' | 'oss' | 'minio';

export interface StorageObject {
  /** 存储内的相对 key, 如 original/xxx.jpg —— 唯一真相, 不含域名 */
  key: string;
  sizeBytes: number;
  contentType: string;
}

export interface StorageProvider {
  readonly backend: StorageBackend;
  /**
   * 可访问 URL。
   *
   * 本地返回 `/uploads/<key>` (由静态服务或签名路由提供);
   * 云端返回完整 URL —— 私有读时可能带签名, 但签名会过期,
   * 因此**只用于页面即时预览, 不入库**。
   */
  url(key: string): Promise<string>;
  put(key: string, data: Buffer, contentType: string): Promise<StorageObject>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  /** 连通性探测 (B-62); 返回是否可用与诊断信息 */
  probe(): Promise<{ ok: boolean; message: string; latencyMs?: number }>;
  /** 凭据状态 (B-63): 只报是否配置与脱敏值, 永不返回明文 */
  credentialStatus(): { configured: boolean; masked?: string; endpoint?: string };
}

/**
 * 防目录穿越: key 只允许字母数字与 - _ /, 且不含 .. 与开头 /
 *
 * 非法 key 若拼进磁盘路径就是任意文件读写漏洞 —— 必须在入口拦死。
 */
export function assertSafeKey(key: string): void {
  if (!key || key.length > 512) throw new Error('非法存储 key');
  if (key.includes('..')) throw new Error('非法存储 key');
  if (key.startsWith('/') || key.includes('\\')) throw new Error('非法存储 key');
  if (!/^[A-Za-z0-9/_.-]+$/.test(key)) throw new Error('非法存储 key');
}

// ─────────────────────────────────────────────────────────────────────
// 本地磁盘
// ─────────────────────────────────────────────────────────────────────

export class LocalStorageProvider implements StorageProvider {
  readonly backend = 'local' as const;

  constructor(
    private readonly root = resolve(process.cwd(), 'uploads'),
    private readonly publicPrefix = '/uploads',
  ) {}

  private abs(key: string): string {
    assertSafeKey(key);
    const full = resolve(this.root, key);
    // 双保险: 即使 assertSafeKey 被绕过, 仍校验解析后路径在 root 内
    if (!full.startsWith(this.root + '/')) throw new Error('非法存储 key');
    return full;
  }

  async url(key: string): Promise<string> {
    return `${this.publicPrefix}/${key}`;
  }

  async put(key: string, data: Buffer): Promise<StorageObject> {
    const full = this.abs(key);
    await fs.mkdir(join(full, '..'), { recursive: true });
    await fs.writeFile(full, data);
    return { key, sizeBytes: data.byteLength, contentType: 'application/octet-stream' };
  }

  async get(key: string): Promise<Buffer> {
    return fs.readFile(this.abs(key));
  }

  async delete(key: string): Promise<void> {
    await fs.unlink(this.abs(key)).catch(() => undefined);
  }

  async exists(key: string): Promise<boolean> {
    return existsSync(this.abs(key));
  }

  async probe() {
    const t0 = Date.now();
    try {
      await fs.mkdir(this.root, { recursive: true });
      // 实写一个探针文件再删 —— 只检查目录可访问不足以证明可写
      const probeKey = `.probe-${Date.now()}`;
      await this.put(probeKey, Buffer.from('ok'));
      await this.delete(probeKey);
      return { ok: true, message: `可读可写: ${this.root}`, latencyMs: Date.now() - t0 };
    } catch (e) {
      return { ok: false, message: `不可写: ${(e as Error).message}` };
    }
  }

  credentialStatus() {
    return { configured: true, endpoint: this.root };
  }
}

// ─────────────────────────────────────────────────────────────────────
// 阿里云 OSS
// ─────────────────────────────────────────────────────────────────────

/** 脱敏: 只保留末 4 位 */
export function maskSecret(v?: string): string | undefined {
  if (!v) return undefined;
  return v.length <= 4 ? '****' : `****${v.slice(-4)}`;
}

export class OssStorageProvider implements StorageProvider {
  readonly backend = 'oss' as const;
  private client: any; // ali-oss 实例, 类型随 SDK 版本变化, 用 any 隔离

  constructor(
    private readonly cfg: {
      region: string;
      bucket: string;
      accessKeyId: string;
      accessKeySecret: string;
      endpoint?: string;
    },
  ) {
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

  async url(key: string): Promise<string> {
    assertSafeKey(key);
    return this.client.signatureUrl(key, { expires: 3600 });
  }

  async put(key: string, data: Buffer, contentType: string): Promise<StorageObject> {
    assertSafeKey(key);
    const res = await this.client.put(key, data, { headers: { 'Content-Type': contentType } });
    return {
      key,
      sizeBytes: Number(res.res?.headers?.['content-length'] ?? data.byteLength),
      contentType,
    };
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
    } catch (e) {
      return { ok: false, message: `连通失败: ${(e as Error).message}` };
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

// ─────────────────────────────────────────────────────────────────────
// MinIO (S3 兼容)
// ─────────────────────────────────────────────────────────────────────

export class MinioStorageProvider implements StorageProvider {
  readonly backend = 'minio' as const;
  private client: any;
  private bucket: string;

  constructor(
    private readonly cfg: {
      endPoint: string;
      port: number;
      useSSL: boolean;
      accessKey: string;
      secretKey: string;
      bucket: string;
    },
  ) {
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

  private base(): string {
    return `${this.cfg.useSSL ? 'https' : 'http'}://${this.cfg.endPoint}:${this.cfg.port}/${this.bucket}`;
  }

  async url(key: string): Promise<string> {
    assertSafeKey(key);
    // presignedGetObject 默认 7 天过期, 足够页面预览
    return this.client.presignedGetObject(this.bucket, key);
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

  async probe() {
    const t0 = Date.now();
    try {
      const ok = await this.client.bucketExists(this.bucket);
      if (!ok) return { ok: false, message: `bucket 不存在: ${this.bucket}` };
      return {
        ok: true,
        message: `连通正常 · ${this.base()}`,
        latencyMs: Date.now() - t0,
      };
    } catch (e) {
      return { ok: false, message: `连通失败: ${(e as Error).message}` };
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

/** 脱敏桶名单: 用于展示凭据是否配置 */
export function maskBucket(v?: string): string | undefined {
  if (!v) return undefined;
  return maskSecret(v);
}