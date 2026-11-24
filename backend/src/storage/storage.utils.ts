/**
 * 存储后端共享工具：key 安全校验、URL 拼接、凭据脱敏与 SDK 探测。
 *
 * 三个 provider 都要用，集中在契约之外，避免 provider 之间互相引用。
 */

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

/** 脱敏: 只保留末 4 位 */
export function maskSecret(v?: string): string | undefined {
  if (!v) return undefined;
  return v.length <= 4 ? '****' : `****${v.slice(-4)}`;
}

/** 脱敏桶名单: 用于展示凭据是否配置 */
export function maskBucket(v?: string): string | undefined {
  if (!v) return undefined;
  return maskSecret(v);
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

/** CDN / 公开域名直读地址：base 已保证不带尾斜杠，key 已由 assertSafeKey 收窄。 */
export function publicObjectUrl(base: string, key: string): string {
  const cleanBase = String(base ?? '').trim().replace(/\/+$/, '');
  const cleanKey = String(key ?? '').trim().replace(/^\/+/, '');
  if (!cleanBase) throw new Error('公开访问域名未配置');
  if (!cleanKey) throw new Error('对象 key 为空');
  return `${cleanBase}/${cleanKey}`;
}