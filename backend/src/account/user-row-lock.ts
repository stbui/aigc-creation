import type { Prisma } from '../generated/prisma/client';

/**
 * 在事务内锁定用户行。
 *
 * 先做一次无实际变化的 UPDATE，让需要互斥的用户级流程（例如支付入账与
 * 邀请关系绑定）串行执行。SQLite 下它取得全库写锁；PostgreSQL 下它对目标
 * 行加 FOR UPDATE 行锁，两个引擎上都能阻止“两边都读旧值再各写”的竞态。
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
