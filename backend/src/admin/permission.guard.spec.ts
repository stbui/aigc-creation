import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppError } from '../common/app.exception';
import { ANY_PERMISSION_KEY, IDENTITY_ONLY_KEY, PERMISSION_KEY } from './admin.decorator';
import { PermissionGuard } from './permission.guard';

type GuardContext = Parameters<PermissionGuard['canActivate']>[0];

function makeContext(request: Record<string, unknown>): GuardContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => function handler() {},
    getClass: () => class Controller {},
  } as unknown as GuardContext;
}

describe('PermissionGuard', () => {
  let reflector: { getAllAndOverride: ReturnType<typeof vi.fn> };
  let roles: { getPermissions: ReturnType<typeof vi.fn> };
  let guard: PermissionGuard;

  beforeEach(() => {
    reflector = { getAllAndOverride: vi.fn() };
    roles = { getPermissions: vi.fn() };
    guard = new PermissionGuard(reflector as never, roles as never);
  });

  it('复合权限全部满足时放行', async () => {
    reflector.getAllAndOverride.mockImplementation((key: string) =>
      key === PERMISSION_KEY ? ['user.read', 'data.export'] : undefined,
    );
    roles.getPermissions.mockResolvedValue(['user.read', 'data.export']);

    await expect(
      guard.canActivate(
        makeContext({
          originalUrl: '/api/v1/admin/users/export',
          adminUser: { id: 'admin-1', email: 'admin@example.com', role: 'operator' },
        }),
      ),
    ).resolves.toBe(true);
  });

  it('缺少任意一个复合权限即拒绝', async () => {
    reflector.getAllAndOverride.mockImplementation((key: string) =>
      key === PERMISSION_KEY ? ['user.read', 'data.export'] : undefined,
    );
    roles.getPermissions.mockResolvedValue(['user.read']);

    await expect(
      guard.canActivate(
        makeContext({
          originalUrl: '/api/v1/admin/users/export',
          adminUser: { id: 'admin-1', email: 'admin@example.com', role: 'operator' },
        }),
      ),
    ).rejects.toMatchObject({ code: 40301 });
  });

  it('任一权限满足时放行（capability.read / logical_model.read）', async () => {
    reflector.getAllAndOverride.mockImplementation((key: string) =>
      key === ANY_PERMISSION_KEY ? ['capability.read', 'logical_model.read'] : undefined,
    );
    roles.getPermissions.mockResolvedValue(['logical_model.read']);

    await expect(
      guard.canActivate(
        makeContext({
          originalUrl: '/api/v1/admin/capabilities',
          adminUser: { id: 'admin-1', email: 'admin@example.com', role: 'operator' },
        }),
      ),
    ).resolves.toBe(true);
  });

  it('任一权限均不满足时拒绝', async () => {
    reflector.getAllAndOverride.mockImplementation((key: string) =>
      key === ANY_PERMISSION_KEY ? ['capability.read', 'logical_model.read'] : undefined,
    );
    roles.getPermissions.mockResolvedValue(['product.price']);

    await expect(
      guard.canActivate(
        makeContext({
          originalUrl: '/api/v1/admin/capabilities',
          adminUser: { id: 'admin-1', email: 'admin@example.com', role: 'operator' },
        }),
      ),
    ).rejects.toMatchObject({ code: 40301 });
  });

  it('未声明权限点的后台端点默认拒绝', async () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);

    await expect(
      guard.canActivate(
        makeContext({
          originalUrl: '/api/v1/admin/unprotected',
          adminUser: { id: 'admin-1', email: 'admin@example.com', role: 'admin' },
        }),
      ),
    ).rejects.toBeInstanceOf(AppError);
    expect(roles.getPermissions).not.toHaveBeenCalled();
  });

  it('显式标记 identity-only 的自省端点无需权限点', async () => {
    reflector.getAllAndOverride.mockImplementation((key: string) =>
      key === IDENTITY_ONLY_KEY ? true : undefined,
    );

    await expect(
      guard.canActivate(
        makeContext({
          originalUrl: '/api/v1/admin/me',
          adminUser: { id: 'admin-1', email: 'admin@example.com', role: 'operator' },
        }),
      ),
    ).resolves.toBe(true);
    expect(roles.getPermissions).not.toHaveBeenCalled();
  });
});
