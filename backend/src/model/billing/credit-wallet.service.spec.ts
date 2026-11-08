import { describe, expect, it, vi } from 'vitest';

import { CreditWalletService } from './credit-wallet.service';

const MICRO = 1_000_000n;

/**
 * 最小钱包数据库桩：只覆盖结算路径用到的表。
 * `expireAt` 决定回填命中的批次是否已过期。
 */
function walletDb(options: { expireAt: Date | null }) {
  const entries: Array<Record<string, any>> = [];
  const db = {
    creditAccount: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      findUnique: vi.fn().mockResolvedValue({
        availableMicrocredits: 95n * MICRO,
        reservedMicrocredits: 0n,
      }),
    },
    creditLot: {
      findMany: vi.fn().mockResolvedValue([{ id: 'lot-1', expireAt: options.expireAt }]),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    creditReservationItem: {
      findMany: vi.fn().mockResolvedValue([{ lotId: 'lot-1', microcredits: 5n * MICRO }]),
    },
    creditLedgerEntry: {
      create: vi.fn().mockImplementation(({ data }) => {
        entries.push(data);
        return {};
      }),
    },
  };
  return { db, entries };
}

function settleOf(db: unknown) {
  return new CreditWalletService().settle(db as never, {
    userId: 'u1',
    billingOrderId: 'bill-1',
    reservedMicrocredits: 5n * MICRO,
    actualMicrocredits: 0n,
  });
}

describe('CreditWalletService 过期批次回填', () => {
  it('结算差额命中已过期批次时立即作废，不增加可用余额', async () => {
    const { db, entries } = walletDb({ expireAt: new Date(Date.now() - 60_000) });

    const result = await settleOf(db);

    // 过期批次不写回：抵扣 5 预留后可用余额净变化为 0
    expect(db.creditLot.updateMany).not.toHaveBeenCalled();
    expect(db.creditAccount.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ availableMicrocredits: { increment: 0n } }),
      }),
    );
    expect(result.refund).toBe(5n * MICRO);

    // 流水必须能自证：refund +5 与 expire -5 成对出现
    expect(entries.map((entry) => entry.type)).toEqual(['consume', 'refund', 'expire']);
    expect(entries[1]).toMatchObject({
      amountMicrocredits: 5n * MICRO,
      availableDeltaMicrocredits: 5n * MICRO,
    });
    expect(entries[2]).toMatchObject({
      amountMicrocredits: -5n * MICRO,
      availableDeltaMicrocredits: -5n * MICRO,
      note: '退款差额命中已过期批次，立即作废',
    });
  });

  it('批次仍有效时照常回填并计入可用余额', async () => {
    const { db, entries } = walletDb({ expireAt: new Date(Date.now() + 60_000) });

    await settleOf(db);

    expect(db.creditLot.updateMany).toHaveBeenCalledWith({
      where: { id: 'lot-1' },
      data: { remainingMicrocredits: { increment: 5n * MICRO } },
    });
    expect(db.creditAccount.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ availableMicrocredits: { increment: 5n * MICRO } }),
      }),
    );
    expect(entries.map((entry) => entry.type)).toEqual(['consume', 'refund']);
  });
});
