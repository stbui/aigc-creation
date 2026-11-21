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
 *   2. **凭据只在服务端使用**: 页面配置以密文落库，状态接口永不返回明文。
 *   3. **key 是唯一真相**: DB 存 storageKey (相对路径), 不存可变的完整 URL ——
 *      切换域名/CDN 后只需改配置, 不必刷库。
 */

/** 全部候选后端。顺序即后台展示顺序：本地优先，云端在后。 */
export const STORAGE_BACKENDS = ['local', 'oss', 'minio'] as const;

export type StorageBackend = (typeof STORAGE_BACKENDS)[number];

/** 收窄运行时字符串，避免各入口重复维护后端白名单。 */
export function isStorageBackend(value: string): value is StorageBackend {
  return STORAGE_BACKENDS.includes(value as StorageBackend);
}

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
  /**
   * 连通性探测 (B-62); 返回是否可用与诊断信息。
   *
   * `verifyWrite` 只由运营主动点「连通性测试」时传入：状态轮询与健康检查
   * 每几秒就跑一次，绝不能每次都在云上写对象（按请求计费、删除失败还会留垃圾）。
   */
  probe(opts?: { verifyWrite?: boolean }): Promise<{ ok: boolean; message: string; latencyMs?: number }>;
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
    /** 对外根地址；配置后页面拿到绝对地址，便于 CDN / 反代场景 */
    private readonly publicBaseUrl?: string,
  ) {}

  private abs(key: string): string {
    assertSafeKey(key);
    const full = resolve(this.root, key);
    // 双保险: 即使 assertSafeKey 被绕过, 仍校验解析后路径在 root 内
    if (!full.startsWith(this.root + '/')) throw new Error('非法存储 key');
    return full;
  }

  async url(key: string): Promise<string> {
    assertSafeKey(key);
    if (this.publicBaseUrl) return publicObjectUrl(this.publicBaseUrl, key);
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
      return { ok: false, message: `不可写: ${(e as Error).message}（${this.root}）` };
    }
  }

  credentialStatus() {
    return {
      configured: true,
      endpoint: this.publicBaseUrl ? `${this.root} → ${this.publicBaseUrl}` : this.root,
    };
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

/**
 * 只解析模块路径、不加载 SDK。启动自检靠它明确告诉运维「还差一个 npm 包」，
 * 而不是等第一次上传才抛 Cannot find module。
 */
export function isSdkInstalled(name: 'ali-oss' | 'minio'): boolean {
  try {
    require.resolve(name);
    return true;
  } catch {
    return false;
  }
}

/**
 * 写探针失败时携带「哪一步」，让后台能直接指出是权限还是读回被改写。
 *
 * 只看 ok=false 的笼统报错，运维无法区分「没有 put 权限」与「出网代理改写了
 * 读回内容」—— 这两种故障的处置方式完全不同。
 */
export class ProbeStepError extends Error {
  constructor(
    public readonly step: '写入' | '读回' | '删除',
    cause: unknown,
  ) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    super(`${step}失败: ${detail}`);
    this.name = 'ProbeStepError';
  }
}

/** 读取内容与刚写入的不一致（单独成类，便于 probe 给出针对性提示）。 */
export class ProbeReadMismatchError extends Error {
  constructor() {
    super('读回内容与写入不一致');
    this.name = 'ProbeReadMismatchError';
  }
}

/**
 * 云端写探针：写 1 字节对象、读回校验、尽力删除。
 *
 * 只读探测（list / bucketExists）只能证明凭据有效且桶可达，证明不了
 * put / get 权限 —— 切过去之后才发现传不上去就晚了。local 的 probe 本来就
 * 实写探针文件，这里把三个后端的「主动测试」语义对齐。
 *
 * 删除放在 finally 里：即使读回失败也要清理探针对象，不能因为一次测试
 * 在桶里留下垃圾。
 */
async function verifyWriteProbe(io: {
  put: (key: string, data: Buffer, contentType: string) => Promise<unknown>;
  get: (key: string) => Promise<Buffer>;
  remove: (key: string) => Promise<unknown>;
}): Promise<string> {
  const key = `.probe-${Date.now()}`;
  const payload = Buffer.from('ok');
  try {
    try {
      await io.put(key, payload, 'text/plain');
    } catch (e) {
      throw new ProbeStepError('写入', e);
    }
    let back: Buffer;
    try {
      back = await io.get(key);
    } catch (e) {
      throw new ProbeStepError('读回', e);
    }
    if (!back.equals(payload)) throw new ProbeReadMismatchError();
    return '读写正常';
  } finally {
    // 删除失败不掩盖探测结论，但对象可能残留 —— 交给 bucket 生命周期规则兜底
    await io.remove(key).catch(() => undefined);
  }
}

/** 探测结论落地文案：把步骤错误翻译成可执行的诊断。 */
function probeFailureMessage(e: unknown): string {
  if (e instanceof ProbeReadMismatchError) {
    return `读写不一致: ${e.message}（检查 Endpoint 或出网代理是否改写请求）`;
  }
  return e instanceof Error ? e.message : String(e);
}

/** CDN / 公开域名直读地址：base 已保证不带尾斜杠，key 已由 assertSafeKey 收窄。 */
export function publicObjectUrl(base: string, key: string): string {
  const cleanBase = String(base ?? '').trim().replace(/\/+$/, '');
  const cleanKey = String(key ?? '').trim().replace(/^\/+/, '');
  if (!cleanBase) throw new Error('公开访问域名未配置');
  if (!cleanKey) throw new Error('对象 key 为空');
  return `${cleanBase}/${cleanKey}`;
}

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

// ─────────────────────────────────────────────────────────────────────
// MinIO (S3 兼容)
// ─────────────────────────────────────────────────────────────────────

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

/** 脱敏桶名单: 用于展示凭据是否配置 */
export function maskBucket(v?: string): string | undefined {
  if (!v) return undefined;
  return maskSecret(v);
}
