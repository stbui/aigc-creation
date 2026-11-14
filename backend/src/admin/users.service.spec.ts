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
    order: {
      count: ReturnType<typeof vi.fn>;
      aggregate: ReturnType<typeof vi.fn>;
      groupBy: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
    };
    refund: { aggregate: ReturnType<typeof vi.fn> };
    ticket: { count: ReturnType<typeof vi.fn> };
    invoice: { count: ReturnType<typeof vi.fn> };
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
      order: {
        count: vi.fn().mockResolvedValue(0),
        aggregate: vi.fn().mockResolvedValue({
          _sum: { paidCents: null, refundedCents: null },
          _count: { _all: 0 },
          _min: { paidAt: null },
          _max: { paidAt: null },
        }),
        groupBy: vi.fn().mockResolvedValue([]),
        findMany: vi.fn().mockResolvedValue([]),
      },
      refund: {
        aggregate: vi.fn().mockResolvedValue({
          _sum: { amountCents: null },
          _count: { _all: 0 },
        }),
      },
      ticket: { count: vi.fn().mockResolvedValue(0) },
      invoice: { count: vi.fn().mockResolvedValue(0) },
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
      {
        displayUrl: (url: string | null | undefined) => url ?? null,
      } as never,
      storage as never,
      membershipService as never,
      {
        balanceOf: vi.fn().mockResolvedValue({
          balance: 0,
          expiringSoon: 0,
          totalEarned: 0,
          totalConsumed: 0,
          activeLots: 0,
          nearestExpiry: null,
        }),
      } as never,
      {
        accessForUser: vi.fn().mockResolvedValue({
          group: {
            code: "default",
            name: "默认分组",
            ratioBasisPoints: 10_000,
          },
        }),
      } as never,
      { notify: vi.fn().mockResolvedValue(undefined) } as never,
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

  it("批量注销必须带确认词，未带时不动账号", async () => {
    await expect(
      service.batchDelete(["user-1"], undefined, "actor-1"),
    ).rejects.toThrow("批量注销需要确认词「删除」");
    expect(lifecycle.softDelete).not.toHaveBeenCalled();
  });

  it("批量注销逐条执行，失败条目只影响自己", async () => {
    lifecycle.softDelete
      .mockResolvedValueOnce({ id: "user-1", deleted: true })
      .mockRejectedValueOnce(new Error("至少保留一个启用的管理员"));

    const summary = await service.batchDelete(
      ["user-1", "user-2", "user-2"],
      "删除",
      "actor-1",
    );

    // 重复 id 去重后只剩两条
    expect(summary).toMatchObject({ total: 2, succeeded: 1, failed: 1 });
    expect(summary.results[1]).toMatchObject({
      id: "user-2",
      ok: false,
      message: "至少保留一个启用的管理员",
    });
    expect(lifecycle.softDelete).toHaveBeenCalledTimes(2);
  });

  it("批量注销单次最多 20 条", async () => {
    const ids = Array.from({ length: 21 }, (_, index) => `user-${index}`);

    await expect(service.batchDelete(ids, "删除", "actor-1")).rejects.toThrow(
      "单次批量最多 20 条",
    );
    expect(lifecycle.softDelete).not.toHaveBeenCalled();
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
      async (args: { by: string[] }) => {
        if (args.by.includes("capability")) {
          return [
            {
              capability: "main_image",
              status: "succeeded",
              _count: { _all: 4 },
            },
          ];
        }
        return args.by.includes("status")
          ? [{ status: "succeeded", _count: { _all: 4 } }]
          : [{ ownerId: "user-1", _count: { _all: 2 } }];
      },
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

  it("详情聚合消费、积分与生成概览", async () => {
    const paidAt = new Date("2026-02-01T00:00:00.000Z");
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
    });
    prisma.order.aggregate.mockResolvedValue({
      _sum: { paidCents: 9900, refundedCents: 1900 },
      _count: { _all: 3 },
      _min: { paidAt },
      _max: { paidAt },
    });
    prisma.order.groupBy.mockResolvedValue([
      { status: "paid", _count: { _all: 2 } },
      { status: "refunded", _count: { _all: 1 } },
      { status: "pending", _count: { _all: 1 } },
    ]);
    prisma.refund.aggregate.mockResolvedValue({
      _sum: { amountCents: 500 },
      _count: { _all: 1 },
    });
    prisma.order.findMany.mockResolvedValue([
      {
        id: "order-1",
        orderNo: "NO-1",
        status: "paid",
        channel: "sandbox",
        totalCents: 9900,
        paidCents: 9900,
        refundedCents: 0,
        createdAt: paidAt,
        paidAt,
        items: [{ nameSnapshot: "积分包" }],
      },
    ]);
    prisma.generationTask.groupBy.mockImplementation(
      async (args: { by: string[] }) => {
        if (args.by.includes("capability")) {
          return [
            {
              capability: "main_image",
              status: "succeeded",
              _count: { _all: 4 },
            },
          ];
        }
        return [{ status: "succeeded", _count: { _all: 4 } }];
      },
    );
    prisma.generationTask.findMany.mockResolvedValue([
      {
        id: "task-1",
        capability: "main_image",
        status: "succeeded",
        createdAt: new Date(),
        outputAsset: null,
      },
    ]);

    const result = await service.detail("user-1");

    expect(result.spending).toMatchObject({
      paidCents: 9900,
      refundedCents: 1900,
      netCents: 8000,
      paidOrders: 3,
      refundingCents: 500,
      refundingOrders: 1,
      orderStatus: {
        total: 4,
        pending: 1,
        paid: 2,
        refunded: 1,
      },
    });
    expect(result.recentOrders[0]).toMatchObject({
      orderNo: "NO-1",
      itemName: "积分包",
      paidCents: 9900,
    });
    expect(result.generation).toMatchObject({
      total: 4,
      succeeded: 4,
      failed: 0,
      successRate: 100,
      last30d: { total: 1, succeeded: 1, failed: 0, successRate: 100 },
    });
    expect(result.generation.byCapability[0]).toMatchObject({
      capability: "main_image",
      count: 4,
      successRate: 100,
    });
    expect(result.credit).toMatchObject({ totalEarned: 0, totalConsumed: 0 });
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
