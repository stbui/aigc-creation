import { beforeEach, describe, expect, it, vi } from "vitest";

import { AdminUsersService } from "./users.service";

describe("AdminUsersService 用户生命周期与角色", () => {
  let tx: Record<string, any>;
  let prisma: {
    user: {
      findUnique: ReturnType<typeof vi.fn>;
      count: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
    generationTask: {
      findMany: ReturnType<typeof vi.fn>;
      groupBy: ReturnType<typeof vi.fn>;
    };
    project: { groupBy: ReturnType<typeof vi.fn> };
    asset: {
      findMany: ReturnType<typeof vi.fn>;
      groupBy: ReturnType<typeof vi.fn>;
    };
    membership: {
      findFirst: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
    };
    membershipUsage: { aggregate: ReturnType<typeof vi.fn> };
    $transaction: ReturnType<typeof vi.fn>;
  };
  let storage: { get: ReturnType<typeof vi.fn> };
  let lifecycle: { softDelete: ReturnType<typeof vi.fn> };
  let membershipService: {
    resolve: ReturnType<typeof vi.fn>;
    historyOf: ReturnType<typeof vi.fn>;
  };
  let service: AdminUsersService;

  beforeEach(() => {
    const table = () => ({
      count: vi.fn().mockResolvedValue(0),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      delete: vi.fn().mockResolvedValue({}),
    });

    tx = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      order: table(),
      payment: table(),
      refund: table(),
      invoice: table(),
      creditLedgerEntry: table(),
      billingOrder: table(),
      asset: {
        findMany: vi.fn().mockResolvedValue([
          { storageBackend: "local", storageKey: "uploads/ok.png" },
          { storageBackend: "oss", storageKey: "uploads/fail.png" },
        ]),
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      user: {
        findUnique: vi.fn().mockResolvedValue({
          _count: { projects: 1, tasks: 2, assets: 2 },
        }),
        update: vi.fn().mockResolvedValue({}),
        delete: vi.fn().mockResolvedValue({}),
      },
      generationTask: table(),
      project: table(),
      membershipUsage: table(),
      membership: table(),
      creditLot: {
        ...table(),
        findMany: vi.fn().mockResolvedValue([{ id: "lot-1" }]),
      },
      creditReservationItem: table(),
      creditAccount: table(),
      inviteRelation: table(),
      checkinRecord: table(),
      ticketReply: table(),
      ticket: table(),
      loginSession: table(),
      notification: table(),
      accountToken: table(),
      oAuthIdentity: table(),
      userPluginState: table(),
      loginLog: table(),
      consentRecord: table(),
      apiCallLog: table(),
    };

    prisma = {
      user: {
        findUnique: vi.fn().mockResolvedValue({
          id: "user-1",
          email: "user@example.com",
          role: "user",
          status: "active",
        }),
        count: vi.fn().mockResolvedValue(2),
        update: vi.fn().mockResolvedValue({}),
      },
      generationTask: {
        findMany: vi.fn().mockResolvedValue([]),
        groupBy: vi.fn().mockResolvedValue([]),
      },
      project: { groupBy: vi.fn().mockResolvedValue([]) },
      asset: {
        findMany: vi.fn().mockResolvedValue([]),
        groupBy: vi.fn().mockResolvedValue([]),
      },
      membership: {
        findFirst: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([]),
      },
      membershipUsage: {
        aggregate: vi.fn().mockResolvedValue({
          _sum: { savedCents: null },
          _count: { _all: 0 },
        }),
      },
      $transaction: vi.fn(
        async (work: (client: Record<string, any>) => unknown) => work(tx),
      ),
    };

    storage = {
      get: vi.fn((backend: string) =>
        backend === "local"
          ? { delete: vi.fn().mockResolvedValue(undefined) }
          : { delete: vi.fn().mockRejectedValue(new Error("oss unavailable")) },
      ),
    };

    lifecycle = {
      softDelete: vi.fn().mockResolvedValue({ id: "user-1", deleted: true }),
    };
    membershipService = {
      resolve: vi.fn().mockResolvedValue({
        isMember: false,
        planCode: "free",
        planName: "普通用户",
        perks: { fastChannel: false, maxConcurrent: 0, addonDiscountBps: 10000 },
        expiresAt: null,
        monthlyCredits: 0,
        cancelAtPeriodEnd: false,
      }),
      historyOf: vi.fn().mockResolvedValue([]),
    };

    service = new AdminUsersService(
      prisma as never,
      lifecycle as never,
      {} as never,
      storage as never,
      membershipService as never,
    );
  });

  it("默认走软注销，不执行物理删除事务", async () => {
    await expect(
      service.remove("user-1", false, undefined, "actor-1"),
    ).resolves.toEqual({ id: "user-1", hard: false });

    expect(lifecycle.softDelete).toHaveBeenCalledWith("user-1");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("拒绝删除当前操作者自己的账号", async () => {
    await expect(
      service.remove("user-1", false, undefined, "user-1"),
    ).rejects.toThrow("不能删除自己的账号");
    expect(lifecycle.softDelete).not.toHaveBeenCalled();
  });

  it("拒绝删除最后一个启用中的管理员", async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      email: "admin@example.com",
      role: "admin",
      status: "active",
    });
    lifecycle.softDelete.mockRejectedValue(
      new Error("至少保留一个启用的管理员"),
    );

    await expect(
      service.remove("user-1", false, undefined, "operator-1"),
    ).rejects.toThrow("至少保留一个启用的管理员");
    expect(lifecycle.softDelete).toHaveBeenCalledWith("user-1");
  });

  it("拒绝物理删除最后一个启用中的管理员，且不清理关联数据", async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      email: "admin@example.com",
      role: "admin",
      status: "active",
    });
    tx.$executeRaw.mockResolvedValue(0);

    await expect(
      service.remove("user-1", true, "删除", "operator-1"),
    ).rejects.toThrow("至少保留一个启用的管理员");
    expect(tx.generationTask.deleteMany).not.toHaveBeenCalled();
    expect(tx.user.delete).not.toHaveBeenCalled();
  });

  it("清理无外键的关联数据，并按实际结果统计文件删除", async () => {
    await expect(
      service.remove("user-1", true, "删除", "actor-1"),
    ).resolves.toMatchObject({
        id: "user-1",
        hard: true,
        removedFiles: 1,
        failedFiles: 1,
      });

    expect(tx.creditReservationItem.deleteMany).toHaveBeenCalledWith({
      where: { lotId: { in: ["lot-1"] } },
    });
    expect(tx.oAuthIdentity.deleteMany).toHaveBeenCalledWith({
      where: { userId: "user-1" },
    });
    expect(tx.userPluginState.deleteMany).toHaveBeenCalledWith({
      where: { userId: "user-1" },
    });
    expect(tx.apiCallLog.updateMany).toHaveBeenCalledWith({
      where: { userId: "user-1" },
      data: { userId: "" },
    });
    expect(tx.user.delete).toHaveBeenCalledWith({ where: { id: "user-1" } });
  });

  it("允许后台把账号降为普通用户", async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      email: "operator@example.com",
      role: "operator",
      status: "active",
    });

    await expect(
      service.changeRole("user-1", { role: "user" }, {
        id: "actor-1",
        role: "admin",
      }),
    ).resolves.toEqual({ id: "user-1", role: "user", roleLabel: "用户" });
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { role: "user" },
    });
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });

  it("拒绝降级最后一个启用中的管理员", async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      email: "admin@example.com",
      role: "admin",
      status: "active",
    });
    tx.$executeRaw.mockResolvedValue(0);

    await expect(
      service.changeRole("user-1", { role: "operator" }, {
        id: "actor-1",
        role: "admin",
      }),
    ).rejects.toThrow("至少保留一个启用的管理员");
    expect(tx.user.update).not.toHaveBeenCalled();
  });

  it("允许降级已禁用的管理员，因为其不提供管理入口", async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      email: "disabled-admin@example.com",
      role: "admin",
      status: "disabled",
    });

    await expect(
      service.changeRole("user-1", { role: "user" }, {
        id: "actor-1",
        role: "admin",
      }),
    ).resolves.toMatchObject({ role: "user" });
    expect(tx.$executeRaw).not.toHaveBeenCalled();
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { role: "user" },
    });
  });

  it("拒绝禁用最后一个启用中的管理员", async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      email: "admin@example.com",
      role: "admin",
      status: "active",
    });
    tx.$executeRaw.mockResolvedValue(0);

    await expect(
      service.changeStatus("user-1", { status: "disabled" }, "actor-1"),
    ).rejects.toThrow("至少保留一个启用的管理员");
    expect(tx.user.update).not.toHaveBeenCalled();
  });

  it("详情统计排除软删项目及其任务与素材", async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      email: "user@example.com",
      name: "用户",
      role: "user",
      status: "active",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      lastLoginAt: null,
      phone: null,
      phoneVerifiedAt: null,
      tokenVersion: 1,
    });
    prisma.project.groupBy.mockResolvedValue([
      { ownerId: "user-1", _count: { _all: 1 } },
    ]);
    prisma.generationTask.groupBy.mockImplementation(
      async (args: { by: string[] }) =>
        args.by.includes("status")
          ? [{ status: "succeeded", _count: { _all: 4 } }]
          : [{ ownerId: "user-1", _count: { _all: 2 } }],
    );
    prisma.asset.groupBy.mockResolvedValue([
      { ownerId: "user-1", _count: { _all: 3 } },
    ]);

    const result = await service.detail("user-1");

    expect(result.stats).toMatchObject({
      projects: 1,
      tasks: 2,
      assets: 3,
      taskStatus: { succeeded: 4, failed: 0, running: 0, queued: 0 },
    });
    expect(prisma.generationTask.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { ownerId: "user-1", project: { deletedAt: null } },
      }),
    );
    expect(prisma.asset.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { ownerId: "user-1", project: { deletedAt: null } },
      }),
    );
    expect(prisma.project.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { ownerId: { in: ["user-1"] }, deletedAt: null },
      }),
    );
    expect(prisma.generationTask.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          ownerId: { in: ["user-1"] },
          project: { deletedAt: null },
        },
      }),
    );
    expect(prisma.asset.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          ownerId: { in: ["user-1"] },
          project: { deletedAt: null },
        },
      }),
    );
  });

  it("详情返回有效会员，已取消续费但未到期仍视为会员", async () => {
    const startAt = new Date("2026-10-01T00:00:00.000Z");
    const expiresAt = new Date("2027-01-01T00:00:00.000Z");
    prisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      email: "member@example.com",
      name: "会员用户",
      role: "user",
      status: "active",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      lastLoginAt: null,
      phone: null,
      phoneVerifiedAt: null,
      _count: { projects: 0, tasks: 0, assets: 0 },
    });
    prisma.membership.findFirst.mockResolvedValue({
      id: "membership-1",
      status: "cancelled",
      startAt,
      expiresAt,
      monthlyCreditsSnapshot: 1000,
      plan: { code: "pro", name: "专业会员" },
    });
    membershipService.resolve.mockResolvedValue({
      isMember: true,
      planCode: "pro",
      planName: "专业会员",
      perks: { fastChannel: true, maxConcurrent: 3, addonDiscountBps: 9500 },
      expiresAt: expiresAt.toISOString(),
      monthlyCredits: 1000,
      cancelAtPeriodEnd: true,
    });
    membershipService.historyOf.mockResolvedValue([
      {
        id: "order-1",
        planCode: "pro",
        planName: "专业会员",
        status: "active",
        startAt,
        expiresAt,
        monthlyCredits: 1000,
      },
    ]);
    prisma.membershipUsage.aggregate.mockResolvedValue({
      _sum: { savedCents: 2880 },
      _count: { _all: 3 },
    });

    const result = await service.detail("user-1");

    expect(result.membership).toEqual({
      isMember: true,
      planCode: "pro",
      planName: "专业会员",
      status: "cancelled",
      startAt,
      expiresAt: expiresAt.toISOString(),
      monthlyCredits: 1000,
      cancelAtPeriodEnd: true,
      savedCents: 2880,
      discountedOrders: 3,
    });
    expect(result.membershipHistory).toEqual([
      {
        id: "order-1",
        planCode: "pro",
        planName: "专业会员",
        status: "active",
        startAt,
        expiresAt,
        monthlyCredits: 1000,
      },
    ]);
    expect(prisma.membership.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: "user-1",
          status: { in: ["active", "grace", "cancelled"] },
        }),
      }),
    );
  });

  it("详情无有效会员时返回空会员状态并保留历史记录", async () => {
    const expiredAt = new Date("2026-09-01T00:00:00.000Z");
    prisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      email: "expired@example.com",
      name: "过期用户",
      role: "user",
      status: "active",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      lastLoginAt: null,
      phone: null,
      phoneVerifiedAt: null,
      _count: { projects: 0, tasks: 0, assets: 0 },
    });
    membershipService.historyOf.mockResolvedValue([
      {
        id: "membership-old",
        planCode: "basic",
        planName: "基础会员",
        status: "expired",
        startAt: new Date("2026-08-01T00:00:00.000Z"),
        expiresAt: expiredAt,
        monthlyCredits: 500,
      },
    ]);

    const result = await service.detail("user-1");

    expect(result.membership).toEqual({
      isMember: false,
      planCode: "free",
      planName: "普通用户",
      status: null,
      startAt: null,
      expiresAt: null,
      monthlyCredits: 0,
      cancelAtPeriodEnd: false,
      savedCents: 0,
      discountedOrders: 0,
    });
    expect(result.membershipHistory).toEqual([
      expect.objectContaining({ id: "membership-old", status: "expired" }),
    ]);
  });
});
