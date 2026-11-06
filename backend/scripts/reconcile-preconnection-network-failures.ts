/**
 * 对账存量「建连前网络失败却被判结果不明」的任务。
 *
 * 背景：旧执行器把所有 outbound_network 都归为 submission_unknown，导致
 * ECONNREFUSED / ENOTFOUND / ENETUNREACH 这类请求根本没到达上游的失败也进入
 * 人工核对并冻结积分。本脚本只处理能同时证明「上游未建立任务」的极端保守子集：
 *   · task.errorCode = 42206，且 task / billing / attempt 均无 providerRequestId；
 *   · 本轮所有 attempt 都没有 accepted / succeeded；
 *   · 最后一个 attempt 是 failed + submission_unknown，失败文本命中建连前 errno；
 *   · 没有 success / pending / billable 的 ApiCallLog；
 *   · 任务无产物、无暂存结果，账单处于 uncertain。
 *
 * 默认只打印计划，不改数据。确认后加 `--apply`：
 *   NODE_ENV=development npx ts-node -T scripts/reconcile-preconnection-network-failures.ts
 *   NODE_ENV=development npx ts-node -T scripts/reconcile-preconnection-network-failures.ts --apply
 *
 * 退款必须走 BillingService.refund（钱包 / 批次 / 流水由唯一写入口处理），不直接改余额。
 */

process.env.NODE_ENV = process.env.NODE_ENV || 'development';

import { PrismaClient } from '@prisma/client';
import { NodeSQLiteDriverAdapterFactory } from '../src/prisma/node-sqlite-adapter';
import { BillingService } from '../src/model/billing/billing.service';
import { CreditWalletService } from '../src/model/billing/credit-wallet.service';
import {
  PRE_CONNECTION_FAILURES,
  preConnectionNetworkFailure,
} from '../src/model/tasks/task-failure-policy';

const { resolveDbPath, resolveDbUrl } = require('./db-url');

const APPLY = process.argv.includes('--apply');
const AUDIT_ACTOR = 'system:preconnection-reconcile';
const AUDIT_NOTE = 'DNS/代理/TCP 建连前网络失败，确认上游未建立任务，自动退款';
const TASK_FAILURE_MESSAGE = '建连前网络失败且无可用线路，积分已自动退回';
const MICROCREDITS_PER_CREDIT = 1_000_000n;

const prisma = new PrismaClient({
  adapter: new NodeSQLiteDriverAdapterFactory({ url: resolveDbUrl() }),
});
const billing = new BillingService(prisma as never, new CreditWalletService());

function text(value: unknown): string {
  return String(value ?? '').trim();
}

function preconnectionCode(attempt: { failureCode: string; failureMessage: string }): string {
  const direct = text(attempt.failureCode);
  if (PRE_CONNECTION_FAILURES.has(direct)) return direct;
  return preConnectionNetworkFailure(text(attempt.failureMessage)) ?? '';
}

function credits(microcredits: bigint): string {
  const whole = microcredits / MICROCREDITS_PER_CREDIT;
  const fraction = microcredits % MICROCREDITS_PER_CREDIT;
  return fraction === 0n ? String(whole) : `${whole}.${String(fraction).padStart(6, '0')}`;
}

async function ineligibleReason(taskId: string, routeRun: number, billingOrderId: string | null): Promise<string> {
  if (!billingOrderId) return '任务没有账单';
  const order = await prisma.billingOrder.findUnique({ where: { id: billingOrderId } });
  if (!order) return '账单不存在';
  if (order.taskId !== taskId) return '账单 taskId 不匹配';
  if (text(order.providerRequestId)) return '账单已有上游请求号';
  if (order.status !== 'uncertain' && !(order.status === 'refunded' && order.resolvedBy === AUDIT_ACTOR)) {
    return `账单状态为 ${order.status}`;
  }

  const attempts = await prisma.routeAttempt.findMany({
    where: { taskId, routeRun },
    orderBy: { attemptNumber: 'asc' },
  });
  if (attempts.length === 0) return '没有线路尝试记录';
  if (attempts.some((attempt) => text(attempt.providerRequestId))) return '线路尝试已有上游请求号';
  if (attempts.some((attempt) => attempt.status === 'succeeded' || attempt.dispatchState === 'accepted')) {
    return '线路尝试显示已被上游受理';
  }

  const latest = attempts[attempts.length - 1];
  if (latest.status !== 'failed' || latest.dispatchState !== 'submission_unknown') {
    return `最后尝试为 ${latest.status}/${latest.dispatchState}`;
  }
  if (!preconnectionCode(latest)) return '失败文本不能证明是建连前失败';

  const unsafeLog = await prisma.apiCallLog.findFirst({
    where: {
      taskId,
      OR: [{ status: { in: ['success', 'pending'] } }, { billable: true }],
    },
    select: { id: true, status: true, billable: true },
  });
  if (unsafeLog) {
    return `存在可能计费/已成功的调用日志 ${unsafeLog.id} (${unsafeLog.status}, billable=${unsafeLog.billable})`;
  }
  return '';
}

async function main(): Promise<void> {
  console.log(`模式: ${APPLY ? 'APPLY（会写入）' : 'DRY-RUN（只读）'}`);
  console.log(`数据库: ${resolveDbPath()}`);

  const tasks = await prisma.generationTask.findMany({
    where: {
      status: 'failed',
      errorCode: '42206',
      outputAssetId: null,
      pendingResult: null,
    },
    orderBy: { createdAt: 'asc' },
  });

  let eligible = 0;
  let refunded = 0;
  let alreadyRefunded = 0;
  let skipped = 0;
  let failed = 0;
  let totalMicrocredits = 0n;

  for (const task of tasks) {
    if (text(task.providerRequestId)) {
      skipped += 1;
      console.log(`[skip] task=${task.id} 任务已有上游请求号`);
      continue;
    }

    const reason = await ineligibleReason(task.id, task.routeRun, task.billingOrderId);
    if (reason) {
      skipped += 1;
      console.log(`[skip] task=${task.id} ${reason}`);
      continue;
    }

    const order = await prisma.billingOrder.findUnique({ where: { id: task.billingOrderId! } });
    const attempts = await prisma.routeAttempt.findMany({
      where: { taskId: task.id, routeRun: task.routeRun },
      orderBy: { attemptNumber: 'asc' },
    });
    const latest = attempts[attempts.length - 1];
    const failureCode = preconnectionCode(latest);
    const amount = order!.reservedAmountMicrocredits > 0n
      ? order!.reservedAmountMicrocredits
      : order!.amountMicrocredits;

    eligible += 1;
    totalMicrocredits += amount;

    if (order!.status === 'refunded') {
      console.log(
        `[finish] task=${task.id} order=${order!.id} code=${failureCode} amount=${credits(amount)} 已完成退款，补写任务终态`,
      );
    } else {
      console.log(
        `[plan] task=${task.id} order=${order!.id} code=${failureCode} amount=${credits(amount)} credits ${APPLY ? 'refund' : 'will-refund'}`,
      );
    }

    if (!APPLY) continue;

    try {
      if (order!.status === 'uncertain') {
        await billing.refund(
          order!.id,
          `${AUDIT_NOTE}；原始错误：${text(latest.failureMessage)}`.slice(0, 1000),
          'failure',
        );
        refunded += 1;
      } else {
        alreadyRefunded += 1;
      }

      const result = await prisma.$transaction(async (tx) => {
        const audit = await tx.billingOrder.updateMany({
          where: { id: order!.id, status: 'refunded', resolvedBy: '' },
          data: { resolvedBy: AUDIT_ACTOR, resolutionNote: AUDIT_NOTE },
        });
        const settledTask = await tx.generationTask.updateMany({
          where: { id: task.id, status: 'failed', errorCode: '42206' },
          data: { errorCode: '42204', mediaRecoveryError: TASK_FAILURE_MESSAGE },
        });
        return { audit: audit.count, tasks: settledTask.count };
      });
      console.log(
        `[done] task=${task.id} order=${order!.id} refunded=${order!.status === 'uncertain'} audit=${result.audit} taskUpdated=${result.tasks}`,
      );
    } catch (error) {
      failed += 1;
      console.error(`[error] task=${task.id} order=${order!.id}: ${(error as Error).message}`);
    }
  }

  console.log('---');
  console.log(
    `扫描 ${tasks.length}，可处理 ${eligible}，本轮回款 ${refunded}，此前已退款 ${alreadyRefunded}，跳过 ${skipped}，失败 ${failed}`,
  );
  console.log(`涉及冻结金额 ${credits(totalMicrocredits)} 积分`);
  if (!APPLY) console.log('未写入任何数据；确认无误后追加 --apply 执行。');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
