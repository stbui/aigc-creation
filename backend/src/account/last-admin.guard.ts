import type { Prisma } from '@prisma/client';

import { AppError } from '../common/app.exception';

/**
 * 在写事务内锁住目标用户，并阻止「最后一个启用管理员」被降级/禁用/删除。
 *
 * SQLite 的 `BEGIN DEFERRED` 不会在事务开始时加写锁；如果先 count 再 update，
 * 两个并发请求可以同时读到 2 个管理员，随后各自把对方停用。这里用一个不做
 * 实际变更的 UPDATE 作为第一条写语句：它会取得数据库写锁，并把「目标是否为
 * 唯一启用管理员」和写锁放在同一条语句里，后续事务只能看到前一个事务的结果。
 */
export async function lockAndAssertActiveAdminMutable(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<void> {
  const affected = await tx.$executeRaw`
    UPDATE "User"
    SET "tokenVersion" = "tokenVersion"
    WHERE "id" = ${userId}
      AND NOT (
        "role" = 'admin'
        AND "status" = 'active'
        AND (
          SELECT COUNT(*)
          FROM "User"
          WHERE "role" = 'admin' AND "status" = 'active'
        ) <= 1
      )
  `;

  if (Number(affected) > 0) return;

  // 0 行既可能是唯一管理员，也可能是用户已被并发删除。后者交给调用方按
  // 不存在处理，不能误报成管理员保护。
  const user = await tx.user.findUnique({
    where: { id: userId },
    select: { id: true },
  });
  if (user) {
    throw new AppError(40901, '至少保留一个启用的管理员', 409);
  }
}
