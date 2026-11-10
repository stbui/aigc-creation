/**
 * 将一个或多个后台账号的业务数据合并到目标账号，并在事务内删除来源账号。
 *
 * 默认只做预演，不写库；确认后加 --apply。
 *
 * 用法：
 *   NODE_ENV=development node scripts/merge-user-accounts.js \
 *     --target=admin@admin.com \
 *     --source=ops@huojue.local \
 *     --source=admin@huojue.local
 *
 *   NODE_ENV=development node scripts/merge-user-accounts.js \
 *     --target=admin@admin.com \
 *     --source=ops@huojue.local \
 *     --source=admin@huojue.local \
 *     --apply
 *
 * 合并规则：
 *   - 订单/支付/退款/发票/积分/会员/项目/素材/任务/消息/工单等归属改为目标账号。
 *   - 旧账号作为操作人的业务记录改为目标账号。
 *   - 旧账号的登录令牌与扫码会话直接删除，不继承登录态。
 *   - 会员、订单幂等键、任务幂等键、签到日、被邀请关系存在冲突时拒绝执行。
 */
const { PrismaClient } = require('@prisma/client');
const { NodeSQLiteDriverAdapterFactory } = require('../dist/prisma/node-sqlite-adapter');
const { resolveDbUrl, resolveDbPath } = require('./db-url');

const args = process.argv.slice(2);
const targetEmail = (args.find((arg) => arg.startsWith('--target=')) || '').slice('--target='.length).trim().toLowerCase();
const sourceEmails = args
  .filter((arg) => arg.startsWith('--source='))
  .map((arg) => arg.slice('--source='.length).trim().toLowerCase())
  .filter(Boolean);
const apply = args.includes('--apply');

if (!targetEmail || sourceEmails.length === 0) {
  console.error('用法: node scripts/merge-user-accounts.js --target=<email> --source=<email> [--source=<email>] [--apply]');
  process.exit(2);
}
if (new Set(sourceEmails).size !== sourceEmails.length || sourceEmails.includes(targetEmail)) {
  console.error('来源账号不能重复，也不能与目标账号相同');
  process.exit(2);
}

function duplicateValues(rows, field) {
  const seen = new Map();
  for (const row of rows) {
    const value = row[field];
    if (value === null || value === undefined || value === '') continue;
    seen.set(value, (seen.get(value) || 0) + 1);
  }
  return [...seen.entries()].filter(([, count]) => count > 1).map(([value]) => value);
}

function maxDate(values) {
  return values.filter(Boolean).reduce((max, value) => (!max || value > max ? value : max), null);
}

async function collectMoveCounts(db, ids) {
  const specs = [
    ['oauthIdentity', db.oAuthIdentity, { userId: { in: ids } }],
    ['orders', db.order, { userId: { in: ids } }],
    ['payments', db.payment, { userId: { in: ids } }],
    ['refunds', db.refund, { userId: { in: ids } }],
    ['creditAccounts', db.creditAccount, { userId: { in: ids } }],
    ['creditLots', db.creditLot, { userId: { in: ids } }],
    ['creditLedger', db.creditLedgerEntry, { userId: { in: ids } }],
    ['billingOrders', db.billingOrder, { userId: { in: ids } }],
    ['memberships', db.membership, { userId: { in: ids } }],
    ['membershipUsage', db.membershipUsage, { userId: { in: ids } }],
    ['projects', db.project, { ownerId: { in: ids } }],
    ['assets', db.asset, { ownerId: { in: ids } }],
    ['generationTasks', db.generationTask, { ownerId: { in: ids } }],
    ['checkins', db.checkinRecord, { userId: { in: ids } }],
    ['loginLogs', db.loginLog, { userId: { in: ids } }],
    ['invoices', db.invoice, { userId: { in: ids } }],
    ['consents', db.consentRecord, { userId: { in: ids } }],
    ['notifications', db.notification, { userId: { in: ids } }],
    ['tickets', db.ticket, { userId: { in: ids } }],
    ['modelCallLogs', db.modelCallLog, { ownerId: { in: ids } }],
  ];
  const counts = {};
  for (const [name, delegate, where] of specs) counts[name] = await delegate.count({ where });
  counts.inviteRelationsAsInviter = await db.inviteRelation.count({ where: { inviterId: { in: ids } } });
  counts.inviteRelationsAsInvitee = await db.inviteRelation.count({ where: { inviteeId: { in: ids } } });
  counts.accountTokens = await db.accountToken.count({ where: { userId: { in: ids } } });
  counts.loginSessions = await db.loginSession.count({ where: { userId: { in: ids } } });
  return counts;
}

async function main() {
  const prisma = new PrismaClient({
    adapter: new NodeSQLiteDriverAdapterFactory({ url: resolveDbUrl() }),
  });

  try {
    const emails = [targetEmail, ...sourceEmails];
    const users = await prisma.user.findMany({
      where: { email: { in: emails } },
      select: { id: true, email: true, role: true, status: true, inviteCode: true, phone: true, lastLoginAt: true },
    });
    const byEmail = new Map(users.map((user) => [user.email, user]));
    const missing = emails.filter((email) => !byEmail.has(email));
    if (missing.length) throw new Error(`账号不存在: ${missing.join(', ')}`);

    const target = byEmail.get(targetEmail);
    const sources = sourceEmails.map((email) => byEmail.get(email));
    if (!target || !sources.length) throw new Error('目标账号或来源账号解析失败');
    if (target.role !== 'admin' || target.status !== 'active') {
      throw new Error(`目标账号不是启用中的管理员: ${target.email}`);
    }

    const allIds = [target.id, ...sources.map((user) => user.id)];
    const sourceIds = sources.map((user) => user.id);

    const orders = await prisma.order.findMany({
      where: { userId: { in: allIds } },
      select: { id: true, userId: true, orderNo: true, idempotencyKey: true },
    });
    const tasks = await prisma.generationTask.findMany({
      where: { ownerId: { in: allIds } },
      select: { id: true, ownerId: true, idempotencyKey: true },
    });
    const checkins = await prisma.checkinRecord.findMany({
      where: { userId: { in: allIds } },
      select: { userId: true, day: true },
    });
    const memberships = await prisma.membership.findMany({
      where: { userId: { in: allIds }, status: { in: ['active', 'grace'] } },
      select: { id: true, userId: true, status: true, expiresAt: true },
    });
    const invitees = await prisma.inviteRelation.count({ where: { inviteeId: { in: allIds } } });

    const conflicts = [];
    const orderKeyConflicts = duplicateValues(orders, 'idempotencyKey');
    if (orderKeyConflicts.length) conflicts.push(`订单幂等键冲突: ${orderKeyConflicts.join(', ')}`);
    const taskKeyConflicts = duplicateValues(tasks, 'idempotencyKey');
    if (taskKeyConflicts.length) conflicts.push(`任务幂等键冲突: ${taskKeyConflicts.join(', ')}`);
    const checkinDayConflicts = duplicateValues(checkins, 'day');
    if (checkinDayConflicts.length) conflicts.push(`签到日冲突: ${checkinDayConflicts.join(', ')}`);
    if (memberships.length > 1) conflicts.push(`有效会员记录冲突: ${memberships.map((item) => item.id).join(', ')}`);
    if (invitees > 1) conflicts.push('目标账号与来源账号同时存在被邀请关系');
    if (conflicts.length) throw new Error(`预检失败\n- ${conflicts.join('\n- ')}`);

    const moveCounts = await collectMoveCounts(prisma, sourceIds);
    const operatorReferences = {
      refundOperators: await prisma.refund.count({ where: { operatorId: { in: sourceIds } } }),
      ledgerOperators: await prisma.creditLedgerEntry.count({ where: { actorUserId: { in: sourceIds } } }),
      invoiceIssuers: await prisma.invoice.count({ where: { issuedBy: { in: sourceIds } } }),
      reconciliationOperators: await prisma.reconciliationBatch.count({ where: { operatorId: { in: sourceIds } } }),
      settingUpdaters: await prisma.systemSetting.count({ where: { updatedBy: { in: sourceIds } } }),
    };

    console.log(`数据库: ${resolveDbPath()}`);
    console.log(`目标账号: ${target.email} (${target.id})`);
    console.log(`来源账号: ${sources.map((user) => `${user.email} (${user.id})`).join(', ')}`);
    console.log('迁移数量:', JSON.stringify(moveCounts, null, 2));
    console.log('操作人引用:', JSON.stringify(operatorReferences, null, 2));
    console.log(`登录令牌/扫码会话将删除: ${moveCounts.accountTokens + moveCounts.loginSessions}`);

    if (!apply) {
      console.log('\n预演完成，未写库。加 --apply 执行。');
      return;
    }

    const result = await prisma.$transaction(async (tx) => {
      const moved = {};
      const moveWhere = async (name, delegate, where, data) => {
        const res = await delegate.updateMany({ where, data });
        moved[name] = res.count;
      };
      const sourceFilter = { in: sourceIds };

      await moveWhere('oauthIdentity', tx.oAuthIdentity, { userId: sourceFilter }, { userId: target.id });
      await moveWhere('orders', tx.order, { userId: sourceFilter }, { userId: target.id });
      await moveWhere('payments', tx.payment, { userId: sourceFilter }, { userId: target.id });
      await moveWhere('refunds', tx.refund, { userId: sourceFilter }, { userId: target.id });
      await moveWhere('creditLots', tx.creditLot, { userId: sourceFilter }, { userId: target.id });
      await moveWhere('creditLedger', tx.creditLedgerEntry, { userId: sourceFilter }, { userId: target.id });
      await moveWhere('billingOrders', tx.billingOrder, { userId: sourceFilter }, { userId: target.id });
      // 账户余额以 CreditAccount 为准，批次迁名后必须同步并入，否则目标账户 = Σ批次 的不变量立刻破掉
      const sourceAccounts = await tx.creditAccount.findMany({ where: { userId: sourceFilter } });
      if (sourceAccounts.length > 0) {
        const available = sourceAccounts.reduce((sum, row) => sum + row.availableMicrocredits, 0n);
        const reserved = sourceAccounts.reduce((sum, row) => sum + row.reservedMicrocredits, 0n);
        await tx.creditAccount.upsert({
          where: { userId: target.id },
          create: { userId: target.id, availableMicrocredits: available, reservedMicrocredits: reserved },
          update: {
            availableMicrocredits: { increment: available },
            reservedMicrocredits: { increment: reserved },
            version: { increment: 1 },
          },
        });
        await tx.creditAccount.deleteMany({ where: { userId: sourceFilter } });
        moved.creditAccountsMerged = sourceAccounts.length;
      }
      await moveWhere('memberships', tx.membership, { userId: sourceFilter }, { userId: target.id });
      await moveWhere('membershipUsage', tx.membershipUsage, { userId: sourceFilter }, { userId: target.id });
      await moveWhere('projects', tx.project, { ownerId: sourceFilter }, { ownerId: target.id });
      await moveWhere('assets', tx.asset, { ownerId: sourceFilter }, { ownerId: target.id });
      await moveWhere('generationTasks', tx.generationTask, { ownerId: sourceFilter }, { ownerId: target.id });
      await moveWhere('checkins', tx.checkinRecord, { userId: sourceFilter }, { userId: target.id });
      await moveWhere('loginLogs', tx.loginLog, { userId: sourceFilter }, { userId: target.id });
      await moveWhere('invoices', tx.invoice, { userId: sourceFilter }, { userId: target.id });
      await moveWhere('consents', tx.consentRecord, { userId: sourceFilter }, { userId: target.id });
      await moveWhere('notifications', tx.notification, { userId: sourceFilter }, { userId: target.id });
      await moveWhere('tickets', tx.ticket, { userId: sourceFilter }, { userId: target.id });
      await moveWhere('modelCallLogs', tx.modelCallLog, { ownerId: sourceFilter }, { ownerId: target.id });
      await moveWhere('inviteRelationsAsInviter', tx.inviteRelation, { inviterId: sourceFilter }, { inviterId: target.id });
      await moveWhere('inviteRelationsAsInvitee', tx.inviteRelation, { inviteeId: sourceFilter }, { inviteeId: target.id });

      moved.accountTokensDeleted = (await tx.accountToken.deleteMany({ where: { userId: sourceFilter } })).count;
      moved.loginSessionsDeleted = (await tx.loginSession.deleteMany({ where: { userId: sourceFilter } })).count;

      await moveWhere('refundOperators', tx.refund, { operatorId: sourceFilter }, { operatorId: target.id });
      await moveWhere('ledgerOperators', tx.creditLedgerEntry, { actorUserId: sourceFilter }, { actorUserId: target.id });
      await moveWhere('invoiceIssuers', tx.invoice, { issuedBy: sourceFilter }, { issuedBy: target.id });
      await moveWhere('reconciliationOperators', tx.reconciliationBatch, { operatorId: sourceFilter }, { operatorId: target.id });
      await moveWhere('settingUpdaters', tx.systemSetting, { updatedBy: sourceFilter }, { updatedBy: target.id });

      const sourceInvite = sources.find((user) => user.inviteCode);
      const sourcePhone = sources.find((user) => user.phone);
      const inviteCode = target.inviteCode || sourceInvite?.inviteCode || null;
      const phone = target.phone || sourcePhone?.phone || null;

      if (sourceInvite?.inviteCode && target.inviteCode !== sourceInvite.inviteCode) {
        await tx.user.update({ where: { id: sourceInvite.id }, data: { inviteCode: null } });
      }
      if (sourcePhone?.phone && target.phone !== sourcePhone.phone) {
        await tx.user.update({ where: { id: sourcePhone.id }, data: { phone: null } });
      }

      await tx.user.update({
        where: { id: target.id },
        data: {
          role: 'admin',
          status: 'active',
          inviteCode,
          phone,
          lastLoginAt: maxDate([target.lastLoginAt, ...sources.map((user) => user.lastLoginAt)]),
        },
      });

      const deletedUsers = await tx.user.deleteMany({ where: { id: sourceFilter } });
      moved.deletedUsers = deletedUsers.count;

      return moved;
    });

    console.log('已合并:', JSON.stringify(result, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error('[merge-user-accounts] 失败:', error.message || error);
  process.exit(1);
});
