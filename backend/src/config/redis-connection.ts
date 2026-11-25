import type { ConnectionOptions } from 'bullmq';

/**
 * 把 `REDIS_URL` 转成 BullMQ / ioredis 的连接参数。
 *
 * 不直接传 URL：BullMQ 的 `connection` 是 ioredis 选项对象，生产与测试
 * 都可能用 `rediss://`、密码或非 0 号库。这里只做一次解析，避免各模块
 * 各写一份 host/port/db 拼装。
 */
export function redisConnectionFromUrl(raw: string): ConnectionOptions {
  const url = new URL(raw);
  if (url.protocol !== 'redis:' && url.protocol !== 'rediss:') {
    throw new Error(`REDIS_URL 只支持 redis:// 或 rediss://，收到 ${url.protocol}`);
  }
  const dbSegment = url.pathname.replace(/^\//, '');
  const db = dbSegment ? Number(dbSegment) : undefined;
  if (db !== undefined && (!Number.isInteger(db) || db < 0)) {
    throw new Error(`REDIS_URL 的数据库编号无效: ${dbSegment}`);
  }
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    ...(url.username ? { username: decodeURIComponent(url.username) } : {}),
    ...(url.password ? { password: decodeURIComponent(url.password) } : {}),
    ...(db !== undefined ? { db } : {}),
    ...(url.protocol === 'rediss:' ? { tls: {} } : {}),
    // BullMQ Worker 的阻塞连接必须关闭 ioredis 的请求超时重试上限。
    maxRetriesPerRequest: null,
  };
}
