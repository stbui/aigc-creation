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