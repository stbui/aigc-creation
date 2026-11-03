import { beforeEach, describe, expect, it, vi } from "vitest";

import { AdminUsersService } from "./users.service";

describe("AdminUsersService 物理删除", () => {
  let tx: Record<string, any>;
  let prisma: {
    user: { findUnique: ReturnType<typeof vi.fn> };
    $transaction: ReturnType<typeof vi.fn>;
  };
  let storage: { get: ReturnType<typeof vi.fn> };
  let service: AdminUsersService;

  beforeEach(() => {
    const table = () => ({
      count: vi.fn().mockResolvedValue(0),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      delete: vi.fn().mockResolvedValue({}),
    });

    tx = {
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

    service = new AdminUsersService(
      prisma as never,
      {} as never,
      {} as never,
      storage as never,
    );
  });

  it("清理无外键的关联数据，并按实际结果统计文件删除", async () => {
    await expect(service.remove("user-1", true, "删除")).resolves.toMatchObject(
      {
        id: "user-1",
        hard: true,
        removedFiles: 1,
        failedFiles: 1,
      },
    );

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
});
