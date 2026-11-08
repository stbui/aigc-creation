import type { Prisma } from '@prisma/client';

/**
 * 在事务内锁定用户行。
 *
 * SQLite 的事务默认是 deferred：先读后写时，另一个事务仍可抢先提交，形成
 * “两边都读旧值、再各自写入”的竞态。这里先做一次无实际变化的 UPDATE，
 * 让需要互斥的用户级流程（例如支付入账与邀请关系绑定）排队执行。
 */
export async function lockUserRow(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<void> {
  await tx.$executeRaw`
    UPDATE "User"
    SET "tokenVersion" = "tokenVersion"
    WHERE "id" = ${userId}
  `;
}
