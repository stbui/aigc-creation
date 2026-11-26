import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthUserCacheService } from './auth-user-cache.service';

describe('AuthUserCacheService', () => {
  let store: Map<string, unknown>;
  let cache: { get: ReturnType<typeof vi.fn>; set: ReturnType<typeof vi.fn>; del: ReturnType<typeof vi.fn> };
  let prisma: { user: { findUnique: ReturnType<typeof vi.fn> } };
  let service: AuthUserCacheService;

  const snapshot = {
    id: 'user-1',
    email: 'user@example.com',
    role: 'user',
    status: 'active',
    tokenVersion: 0,
    mustChangePassword: false,
    tempPasswordExpiresAt: null,
  };

  beforeEach(() => {
    store = new Map();
    cache = {
      get: vi.fn(async (key: string) => store.get(key)),
      set: vi.fn(async (key: string, value: unknown) => { store.set(key, value); }),
      del: vi.fn(async (key: string) => { store.delete(key); }),
    };
    prisma = { user: { findUnique: vi.fn().mockResolvedValue(snapshot) } };
    service = new AuthUserCacheService(prisma as never, cache as never);
  });

  it('缓存命中时不再次查库', async () => {
    await expect(service.get('user-1')).resolves.toEqual(snapshot);
    await expect(service.get('user-1')).resolves.toEqual(snapshot);
    expect(prisma.user.findUnique).toHaveBeenCalledTimes(1);
    expect(cache.set).toHaveBeenCalledTimes(1);
  });

  it('invalidate 后下一次 get 重新查库', async () => {
    await service.get('user-1');
    await service.invalidate('user-1');
    expect(cache.del).toHaveBeenCalledWith('auth:user:user-1');
    await service.get('user-1');
    expect(prisma.user.findUnique).toHaveBeenCalledTimes(2);
  });

  it('查不到用户时缓存 null，不把"账号不存在"当成异常', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(service.get('ghost')).resolves.toBeNull();
    await expect(service.get('ghost')).resolves.toBeNull();
    expect(prisma.user.findUnique).toHaveBeenCalledTimes(1);
  });
});
