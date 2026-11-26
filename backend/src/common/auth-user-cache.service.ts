import { Inject, Injectable } from '@nestjs/common';
import { CACHE_MANAGER, type Cache } from '@nestjs/cache-manager';
import { PrismaService } from '../prisma/prisma.service';

/** 兜底 TTL：写入点漏挂 invalidate 时，禁用/改密最多延迟 2 秒生效 */
const AUTH_USER_TTL_MS = 2_000;
const keyOf = (userId: string) => `auth:user:${userId}`;

/**
 * 鉴权用户快照缓存。
 *
 * 缓存 JwtAuthGuard 判定所需的全部用户列，把每请求一次 SQLite 查询降为
 * 进程内命中。语义保持「禁用/改密立即生效」：所有改这些列的写入点
 * 必须调用 invalidate() 显式删除；TTL 只是漏挂时的兜底，不是失效主路径。
 *
 * 单实例语义：多实例部署时各进程独立，写入方的 invalidate 只清自己进程。
 * 这与 CacheModule 边界一致；真要多实例需换共享 store（见 cache.module.ts）。
 */
export interface AuthUserSnapshot {
  id: string;
  email: string;
  role: string;
  status: string;
  tokenVersion: number;
  mustChangePassword: boolean;
  tempPasswordExpiresAt: Date | null;
}

@Injectable()
export class AuthUserCacheService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) {}

  async get(userId: string): Promise<AuthUserSnapshot | null> {
    const key = keyOf(userId);
    const hit = await this.cache.get<AuthUserSnapshot>(key);
    if (hit !== undefined) return hit;

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        role: true,
        status: true,
        tokenVersion: true,
        mustChangePassword: true,
        tempPasswordExpiresAt: true,
      },
    });
    const snapshot: AuthUserSnapshot | null = user ? { ...user } : null;
    await this.cache.set(key, snapshot, AUTH_USER_TTL_MS);
    return snapshot;
  }

  /** 鉴权状态写入后必须调用。不调也能等 2s TTL，但禁用/改密应即时生效 */
  async invalidate(userId: string): Promise<void> {
    await this.cache.del(keyOf(userId));
  }
}
