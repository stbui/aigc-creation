/**
 * 脚本侧的积分夹具：发放与清理。
 *
 * 为什么不让脚本直接 `creditLot.create`：金额在库里是**微积分**，而余额接口
 * 读的是 `CreditAccount`。只插批次不建账户，`/credits/balance` 永远是 0，
 * 所有「扣费 / 退款」断言都会静默失真。两处必须同生共死，这里统一封装。
 */

const SCALE = 1_000_000n;

/** 积分（整数）→ 微积分；脚本只发放整数额度，出现小数说明传错了口径 */
function toMicrocredits(credits) {
  const value = Number(credits);
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    throw new Error(`脚本发放的积分必须是整数：${credits}`);
  }
  return BigInt(value) * SCALE;
}

/**
 * 发放积分：建批次 + 加账户可用余额 + 写一条流水。
 *
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {{ userId: string, credits: number, source?: string, type?: string, expireAt?: Date | null, reason?: string }} input
 */
async function grantCredits(prisma, input) {
  const amount = toMicrocredits(input.credits);
  const type = input.type ?? 'grant';
  const lot = await prisma.creditLot.create({
    data: {
      userId: input.userId,
      source: input.source ?? 'grant',
      totalMicrocredits: amount,
      remainingMicrocredits: amount,
      expireAt: input.expireAt ?? null,
    },
  });
  const account = await prisma.creditAccount.upsert({
    where: { userId: input.userId },
    create: { userId: input.userId, availableMicrocredits: amount },
    update: { availableMicrocredits: { increment: amount }, version: { increment: 1 } },
  });
  await prisma.creditLedgerEntry.create({
    data: {
      userId: input.userId,
      type,
      amountMicrocredits: amount,
      availableDeltaMicrocredits: amount,
      availableAfterMicrocredits: account.availableMicrocredits,
      reservedAfterMicrocredits: account.reservedMicrocredits,
      lotId: lot.id,
      note: input.reason ?? '',
    },
  });
  return lot;
}

/**
 * 清理测试账号的积分数据：预留明细 → 账单 → 流水 → 批次 → 账户。
 *
 * 顺序不可颠倒：预留明细以批次为主键的一部分，账单是流水的业务来源。
 *
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {string | { in: string[] }} userId 单个 id 或 `{ in: [...] }`
 */
async function clearCredits(prisma, userId) {
  const where = typeof userId === 'string' ? { userId } : { userId };
  const lots = await prisma.creditLot.findMany({ where, select: { id: true } });
  if (lots.length > 0) {
    await prisma.creditReservationItem.deleteMany({ where: { lotId: { in: lots.map((lot) => lot.id) } } });
  }
  await prisma.billingOrder.deleteMany({ where });
  await prisma.creditLedgerEntry.deleteMany({ where });
  await prisma.creditLot.deleteMany({ where });
  await prisma.creditAccount.deleteMany({ where });
}

module.exports = { SCALE, toMicrocredits, grantCredits, clearCredits };
