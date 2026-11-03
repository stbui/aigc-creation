import { firstValueFrom, of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AUDIT_ACTION_KEY,
  AUDIT_TARGET_KEY,
  type AuditTargetMetadata,
} from './admin.decorator';
import { AuditInterceptor } from './audit.interceptor';

type InterceptorContext = Parameters<AuditInterceptor['intercept']>[0];

describe('AuditInterceptor', () => {
  let prisma: { adminAuditLog: { create: ReturnType<typeof vi.fn> } };
  let reflector: { get: ReturnType<typeof vi.fn> };
  let interceptor: AuditInterceptor;

  beforeEach(() => {
    prisma = { adminAuditLog: { create: vi.fn().mockResolvedValue({}) } };
    reflector = { get: vi.fn() };
    interceptor = new AuditInterceptor(prisma as never, reflector as never);
  });

  function context(request: Record<string, unknown>): InterceptorContext {
    return {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => function handler() {},
      getClass: () => class Controller {},
    } as unknown as InterceptorContext;
  }

  it('嵌套渠道模型路由按声明写入真实对象 id', async () => {
    const target: AuditTargetMetadata = { targetType: 'channel_model', param: 'modelId' };
    reflector.get.mockImplementation((key: string) => {
      if (key === AUDIT_ACTION_KEY) return 'channel_model.update';
      if (key === AUDIT_TARGET_KEY) return target;
      return undefined;
    });

    await firstValueFrom(
      interceptor.intercept(
        context({
          originalUrl: '/api/v1/admin/channels/c1/models/m2',
          url: '/api/v1/admin/channels/c1/models/m2',
          method: 'PATCH',
          params: { id: 'c1', modelId: 'm2' },
          body: { modelId: 'm2', priority: 10 },
          ip: '127.0.0.1',
          adminUser: { id: 'admin-1', email: 'admin@example.com', role: 'admin' },
        }),
        { handle: () => of({ ok: true }) },
      ),
    );

    await vi.waitFor(() => expect(prisma.adminAuditLog.create).toHaveBeenCalled());
    expect(prisma.adminAuditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'channel_model.update',
        targetType: 'channel_model',
        targetId: 'm2',
        success: true,
      }),
    });
  });

  it('未声明审计对象时保留 URL 推断回退', async () => {
    reflector.get.mockImplementation((key: string) =>
      key === AUDIT_ACTION_KEY ? 'user.disable' : undefined,
    );

    await firstValueFrom(
      interceptor.intercept(
        context({
          originalUrl: '/api/v1/admin/users/u1/disable',
          url: '/api/v1/admin/users/u1/disable',
          method: 'POST',
          params: { id: 'u1' },
          body: { reason: 'risk' },
          ip: '127.0.0.1',
          adminUser: { id: 'admin-1', email: 'admin@example.com', role: 'admin' },
        }),
        { handle: () => of({ ok: true }) },
      ),
    );

    await vi.waitFor(() => expect(prisma.adminAuditLog.create).toHaveBeenCalled());
    expect(prisma.adminAuditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'user.disable',
        targetType: 'users',
        targetId: 'u1',
        success: true,
      }),
    });
  });
});
