import { beforeEach, describe, expect, it, vi } from "vitest";

import { AccountLifecycleService } from "./account-lifecycle.service";

describe("AccountLifecycleService 软注销", () => {
  let tx: Record<string, any>;
  let prisma: {
    user: { findUnique: ReturnType<typeof vi.fn> };
    asset: { findMany: ReturnType<typeof vi.fn> };
    $transaction: ReturnType<typeof vi.fn>;
  };
  let service: AccountLifecycleService;

  beforeEach(() => {
    const table = () => ({
      findMany: vi.fn().mockResolvedValue([]),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      update: vi.fn().mockResolvedValue({}),
    });

    tx = {
      generationTask: table(),
      asset: table(),
      project: table(),
      creditLot: table(),
      creditReservationItem: table(),
      creditAccount: table(),
      membership: table(),
      loginSession: table(),
      notification: table(),
      accountToken: table(),
      oAuthIdentity: table(),
      userPluginState: table(),
      loginLog: table(),
      consentRecord: table(),
      user: table(),
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
      asset: { findMany: vi.fn().mockResolvedValue([]) },
      $transaction: vi.fn(
        async (work: (client: Record<string, any>) => unknown) => work(tx),
      ),
    };

    service = new AccountLifecycleService(
      prisma as never,
      { get: vi.fn() } as never,
    );
  });

  it("清理第三方身份和插件偏好，避免删除账号继续占用外部身份", async () => {
    await expect(service.softDelete("user-1")).resolves.toMatchObject({
      id: "user-1",
      deleted: true,
    });

    expect(tx.oAuthIdentity.deleteMany).toHaveBeenCalledWith({
      where: { userId: "user-1" },
    });
    expect(tx.userPluginState.deleteMany).toHaveBeenCalledWith({
      where: { userId: "user-1" },
    });
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: expect.objectContaining({ status: "deleted" }),
    });
  });
});
