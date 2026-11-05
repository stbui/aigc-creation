import { firstValueFrom, of } from "rxjs";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  AUDIT_ACTION_KEY,
  AUDIT_TARGET_KEY,
  type AuditTargetMetadata,
} from "./admin.decorator";
import { AuditInterceptor } from "./audit.interceptor";

type InterceptorContext = Parameters<AuditInterceptor["intercept"]>[0];

describe("AuditInterceptor", () => {
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

  it("嵌套渠道模型路由按声明写入真实对象 id", async () => {
    const target: AuditTargetMetadata = {
      targetType: "channel_model",
      param: "modelId",
    };
    reflector.get.mockImplementation((key: string) => {
      if (key === AUDIT_ACTION_KEY) return "channel_model.update";
      if (key === AUDIT_TARGET_KEY) return target;
      return undefined;
    });

    await firstValueFrom(
      interceptor.intercept(
        context({
          originalUrl: "/api/v1/admin/channels/c1/models/m2",
          url: "/api/v1/admin/channels/c1/models/m2",
          method: "PATCH",
          params: { id: "c1", modelId: "m2" },
          body: { modelId: "m2", priority: 10 },
          ip: "127.0.0.1",
          adminUser: {
            id: "admin-1",
            email: "admin@example.com",
            role: "admin",
          },
        }),
        { handle: () => of({ ok: true }) },
      ),
    );

    await vi.waitFor(() =>
      expect(prisma.adminAuditLog.create).toHaveBeenCalled(),
    );
    expect(prisma.adminAuditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "channel_model.update",
        targetType: "channel_model",
        targetId: "m2",
        success: true,
      }),
    });
  });

  it("未声明审计对象时保留 URL 推断回退", async () => {
    reflector.get.mockImplementation((key: string) =>
      key === AUDIT_ACTION_KEY ? "user.disable" : undefined,
    );

    await firstValueFrom(
      interceptor.intercept(
        context({
          originalUrl: "/api/v1/admin/users/u1/disable",
          url: "/api/v1/admin/users/u1/disable",
          method: "POST",
          params: { id: "u1" },
          body: { reason: "risk" },
          ip: "127.0.0.1",
          adminUser: {
            id: "admin-1",
            email: "admin@example.com",
            role: "admin",
          },
        }),
        { handle: () => of({ ok: true }) },
      ),
    );

    await vi.waitFor(() =>
      expect(prisma.adminAuditLog.create).toHaveBeenCalled(),
    );
    expect(prisma.adminAuditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "user.disable",
        targetType: "users",
        targetId: "u1",
        success: true,
      }),
    });
  });

  it("按动作和状态自动生成原因，并忽略请求体 reason", async () => {
    reflector.get.mockImplementation((key: string) =>
      key === AUDIT_ACTION_KEY ? "user.status_change" : undefined,
    );

    await firstValueFrom(
      interceptor.intercept(
        context({
          originalUrl: "/api/v1/admin/users/u1/status",
          url: "/api/v1/admin/users/u1/status",
          method: "PATCH",
          params: { id: "u1" },
          body: { status: "disabled", reason: "请求体里的自由文本" },
          ip: "127.0.0.1",
          adminUser: {
            id: "admin-1",
            email: "admin@example.com",
            role: "admin",
          },
        }),
        { handle: () => of({ ok: true }) },
      ),
    );

    await vi.waitFor(() =>
      expect(prisma.adminAuditLog.create).toHaveBeenCalled(),
    );
    const data = prisma.adminAuditLog.create.mock.calls[0][0].data;
    expect(data.reason).toBe("禁用用户账号");
    expect(JSON.parse(data.detail)).not.toHaveProperty("reason");
  });

  it("批量删除任务使用自动原因和结构化审计摘要", async () => {
    reflector.get.mockImplementation((key: string) =>
      key === AUDIT_ACTION_KEY ? "task.batch" : undefined,
    );

    await firstValueFrom(
      interceptor.intercept(
        context({
          originalUrl: "/api/v1/admin/tasks/batch",
          url: "/api/v1/admin/tasks/batch",
          method: "POST",
          body: { ids: ["t1", "t2"], action: "delete" },
          ip: "127.0.0.1",
          adminUser: {
            id: "admin-1",
            email: "admin@example.com",
            role: "admin",
          },
        }),
        { handle: () => of({ ok: true }) },
      ),
    );

    await vi.waitFor(() =>
      expect(prisma.adminAuditLog.create).toHaveBeenCalled(),
    );
    const data = prisma.adminAuditLog.create.mock.calls[0][0].data;
    expect(data.reason).toBe("批量删除任务及其产出");
    expect(JSON.parse(data.detail)).toEqual({ ok: true });
  });

  it("逐条批量结果分别写审计并保留单条失败原因", async () => {
    reflector.get.mockImplementation((key: string) =>
      key === AUDIT_ACTION_KEY ? "task.batch" : undefined,
    );

    await firstValueFrom(
      interceptor.intercept(
        context({
          originalUrl: "/api/v1/admin/tasks/batch",
          url: "/api/v1/admin/tasks/batch",
          method: "POST",
          body: { ids: ["t1", "t2"], action: "delete" },
          ip: "127.0.0.1",
          adminUser: {
            id: "admin-1",
            email: "admin@example.com",
            role: "admin",
          },
        }),
        {
          handle: () =>
            of({
              total: 2,
              succeeded: 1,
              failed: 1,
              results: [
                { id: "t1", ok: true, data: { id: "t1" } },
                { id: "t2", ok: false, message: "任务不存在" },
              ],
            }),
        },
      ),
    );

    await vi.waitFor(() =>
      expect(prisma.adminAuditLog.create).toHaveBeenCalledTimes(2),
    );
    const [first, second] = prisma.adminAuditLog.create.mock.calls.map(
      ([call]) => call.data,
    );
    expect(first).toMatchObject({
      action: "task.batch",
      targetType: "tasks",
      targetId: "t1",
      success: true,
    });
    expect(JSON.parse(first.detail)).toEqual({
      ok: true,
      batch: { total: 2, succeeded: 1, failed: 1 },
    });
    expect(second).toMatchObject({
      action: "task.batch",
      targetType: "tasks",
      targetId: "t2",
      success: false,
    });
    expect(JSON.parse(second.detail)).toEqual({
      ok: false,
      batch: { total: 2, succeeded: 1, failed: 1 },
      error: "任务不存在",
    });
  });

  it("兼容积分批量的 userId/success 结果形状", async () => {
    reflector.get.mockImplementation((key: string) =>
      key === AUDIT_ACTION_KEY ? "credit.batch_adjust" : undefined,
    );

    await firstValueFrom(
      interceptor.intercept(
        context({
          originalUrl: "/api/v1/admin/credits/batch-adjust",
          url: "/api/v1/admin/credits/batch-adjust",
          method: "POST",
          body: { reason: "补偿" },
          ip: "127.0.0.1",
          adminUser: {
            id: "admin-1",
            email: "admin@example.com",
            role: "admin",
          },
        }),
        {
          handle: () =>
            of({
              total: 1,
              succeeded: 0,
              failed: 1,
              results: [
                {
                  userId: "user-1",
                  success: false,
                  message: "用户不存在",
                },
              ],
            }),
        },
      ),
    );

    await vi.waitFor(() =>
      expect(prisma.adminAuditLog.create).toHaveBeenCalledTimes(1),
    );
    const data = prisma.adminAuditLog.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      action: "credit.batch_adjust",
      targetType: "users",
      targetId: "user-1",
      success: false,
    });
    expect(JSON.parse(data.detail)).toEqual({
      ok: false,
      batch: { total: 1, succeeded: 0, failed: 1 },
      error: "用户不存在",
    });
  });

  it("仅退款核销动作记录处理结果、原因与退款单号", async () => {
    reflector.get.mockImplementation((key: string) =>
      key === AUDIT_ACTION_KEY ? "order.refund_confirm" : undefined,
    );

    await firstValueFrom(
      interceptor.intercept(
        context({
          originalUrl: "/api/v1/admin/orders/o1/refunds/r1/confirm",
          url: "/api/v1/admin/orders/o1/refunds/r1/confirm",
          method: "POST",
          params: { id: "o1", refundId: "r1" },
          body: {
            outcome: "succeeded",
            reason: "已核对渠道退款成功",
            providerRefundId: "wx-r1",
          },
          ip: "127.0.0.1",
          adminUser: {
            id: "admin-1",
            email: "admin@example.com",
            role: "admin",
          },
        }),
        { handle: () => of({ ok: true }) },
      ),
    );

    await vi.waitFor(() =>
      expect(prisma.adminAuditLog.create).toHaveBeenCalled(),
    );
    const data = prisma.adminAuditLog.create.mock.calls[0][0].data;
    expect(data.reason).toBe("人工核销异步退款");
    expect(data.targetId).toBe("o1");
    expect(JSON.parse(data.detail)).toEqual({
      ok: true,
      outcome: "succeeded",
      reason: "已核对渠道退款成功",
      providerRefundId: "wx-r1",
      refundId: "r1",
    });
  });
});
