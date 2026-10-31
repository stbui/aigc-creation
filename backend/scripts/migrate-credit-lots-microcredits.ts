/**
 * 一次性数据迁移：积分批次与流水由「整积分」改为「微积分」。
 *
 * 背景：P4 生成账单按微积分预留/结算，批次精度必须同步落到 1 微积分；
 * Prisma 的列改名在 SQLite 上是「删列 + 建列」，直接 `db push` 会丢数据。
 *
 * 用法（顺序不可颠倒）：
 *   node -r ts-node/register/transpile-only scripts/migrate-credit-lots-microcredits.ts dump
 *   npx prisma db push --accept-data-loss
 *   node -r ts-node/register/transpile-only scripts/migrate-credit-lots-microcredits.ts restore
 *
 * 全部走 `$queryRawUnsafe` / `$executeRawUnsafe`：迁移前后 Prisma Client 的列名不同，
 * 用强类型 API 会让脚本只能在其中一侧编译通过。
 */

import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { PrismaClient } from '@prisma/client';
import { NodeSQLiteDriverAdapterFactory } from '../src/prisma/node-sqlite-adapter';

// 与后端脚本同一档位：NODE_ENV 决定连哪个库，避免迁移写错环境
const { resolveDbUrl } = require('./db-url');

const prisma = new PrismaClient({
  adapter: new NodeSQLiteDriverAdapterFactory({ url: resolveDbUrl() }),
});
const DUMP_PATH = join(__dirname, '..', 'backups', 'credit-microcredits-dump.json');
const SCALE = 1_000_000n;

interface LotRow {
  id: string;
  userId: string;
  source: string;
  orderId: string | null;
  totalCredits: number | bigint;
  remainingCredits: number | bigint;
  expireAt: string | number | null;
  createdAt: string | number;
}

interface LedgerRow {
  id: string;
  userId: string;
  type: string;
  amount: number | bigint;
  balanceAfter: number | bigint;
  lotId: string | null;
  orderId: string | null;
  taskId: string | null;
  reason: string | null;
  operatorId: string | null;
  createdAt: string | number;
}

/** 日期列经 raw 查询可能是字符串或毫秒数，统一转 ISO 字符串落盘 */
function toIso(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  const date = value instanceof Date ? value : new Date(value as string | number);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function toNumber(value: unknown): number {
  if (typeof value === 'bigint') return Number(value);
  return Number(value ?? 0);
}

async function dump(): Promise<void> {
  const lots = (await prisma.$queryRawUnsafe(
    'SELECT id, userId, source, orderId, totalCredits, remainingCredits, expireAt, createdAt FROM CreditLot',
  )) as LotRow[];
  const ledger = (await prisma.$queryRawUnsafe(
    'SELECT id, userId, type, amount, balanceAfter, lotId, orderId, taskId, reason, operatorId, createdAt FROM CreditLedger',
  )) as LedgerRow[];

  const payload = {
    dumpedAt: new Date().toISOString(),
    lots: lots.map((row) => ({
      id: row.id,
      userId: row.userId,
      source: row.source,
      orderId: row.orderId,
      totalCredits: toNumber(row.totalCredits),
      remainingCredits: toNumber(row.remainingCredits),
      expireAt: toIso(row.expireAt),
      createdAt: toIso(row.createdAt),
    })),
    ledger: ledger.map((row) => ({
      id: row.id,
      userId: row.userId,
      type: row.type,
      amount: toNumber(row.amount),
      balanceAfter: toNumber(row.balanceAfter),
      lotId: row.lotId,
      orderId: row.orderId,
      taskId: row.taskId,
      reason: row.reason,
      operatorId: row.operatorId,
      createdAt: toIso(row.createdAt),
    })),
  };
  writeFileSync(DUMP_PATH, JSON.stringify(payload, null, 2), 'utf8');
  console.log(`已导出 ${payload.lots.length} 个批次、${payload.ledger.length} 条流水 → ${DUMP_PATH}`);
}

const LEGACY_TYPES = new Set(['consume', 'grant', 'purchase', 'admin_adjust', 'refund_reclaim', 'expire']);

async function restore(): Promise<void> {
  const payload = JSON.parse(readFileSync(DUMP_PATH, 'utf8')) as {
    lots: Array<{ id: string; userId: string; totalCredits: number; remainingCredits: number }>;
    ledger: Array<{
      id: string;
      userId: string;
      type: string;
      amount: number;
      balanceAfter: number;
      orderId: string | null;
      taskId: string | null;
      reason: string | null;
      operatorId: string | null;
      createdAt: string | null;
    }>;
  };

  let lotCount = 0;
  for (const lot of payload.lots) {
    await prisma.$executeRawUnsafe(
      'UPDATE CreditLot SET totalMicrocredits = ?, remainingMicrocredits = ? WHERE id = ?',
      BigInt(lot.totalCredits) * SCALE,
      BigInt(lot.remainingCredits) * SCALE,
      lot.id,
    );
    lotCount += 1;
  }

  // 账户余额 = 各批次剩余之和（过期批次不计入可用）
  const now = new Date().toISOString();
  const available = new Map<string, bigint>();
  const lots = (await prisma.$queryRawUnsafe(
    'SELECT userId, remainingMicrocredits, expireAt FROM CreditLot WHERE remainingMicrocredits > 0',
  )) as Array<{ userId: string; remainingMicrocredits: bigint; expireAt: unknown }>;
  for (const row of lots) {
    const expiry = row.expireAt ? new Date(row.expireAt as string) : null;
    if (expiry && expiry.getTime() <= Date.now()) continue;
    available.set(row.userId, (available.get(row.userId) ?? 0n) + BigInt(row.remainingMicrocredits));
  }
  for (const [userId, amount] of available) {
    await prisma.$executeRawUnsafe(
      'INSERT INTO CreditAccount (userId, availableMicrocredits, reservedMicrocredits, version, createdAt, updatedAt) VALUES (?, ?, 0, 0, ?, ?)',
      userId,
      amount,
      now,
      now,
    );
  }

  // 旧流水原样迁到 CreditLedgerEntry：历史余额快照按 ×1e6 换算，
  // `referenceKey` 保证脚本重复执行不会产生两条同一来源的记录
  let ledgerCount = 0;
  for (const row of payload.ledger) {
    const type = LEGACY_TYPES.has(row.type) ? row.type : 'adjust';
    const createdAt = row.createdAt ?? new Date().toISOString();
    await prisma.$executeRawUnsafe(
      `INSERT OR IGNORE INTO CreditLedgerEntry
        (id, userId, type, amountMicrocredits, availableDeltaMicrocredits, reservedDeltaMicrocredits,
         availableAfterMicrocredits, reservedAfterMicrocredits, billingOrderId, paymentOrderId, actorUserId,
         model, channelId, scene, note, referenceKey, createdAt)
       VALUES (?, ?, ?, ?, ?, 0, ?, 0, '', ?, ?, '', '', '', ?, ?, ?)`,
      `legacy_${row.id}`,
      row.userId,
      type,
      BigInt(row.amount) * SCALE,
      BigInt(row.amount) * SCALE,
      BigInt(row.balanceAfter) * SCALE,
      row.orderId ?? '',
      row.operatorId ?? '',
      row.reason ?? '',
      `legacy:${row.id}`,
      createdAt,
    );
    ledgerCount += 1;
  }

  console.log(`已回填 ${lotCount} 个批次、${available.size} 个账户、${ledgerCount} 条历史流水`);
}

async function main(): Promise<void> {
  const mode = process.argv[2];
  if (mode === 'dump') {
    await dump();
    return;
  }
  if (mode === 'restore') {
    await restore();
    return;
  }
  throw new Error('用法: migrate-credit-lots-microcredits.ts <dump|restore>');
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
