import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PrismaService } from '../../prisma/prisma.service';
import { BillingSweeperService } from './billing-sweeper.service';

const BACKEND_ROOT = process.cwd();
const DB_DIR = mkdtempSync(join(tmpdir(), 'huojue-billing-sweep-it-'));
const DB_PATH = join(DB_DIR, 'billing-sweep.db');
const DB_URL = `file:${DB_PATH}`;

let prisma: PrismaService;
let userId = '';
let projectId = '';

beforeAll(async () => {
  execFileSync(
    join(BACKEND_ROOT, 'node_modules', '.bin', 'prisma'),
    ['db', 'push', '--url', DB_URL],
    {
      cwd: BACKEND_ROOT,
      env: { ...process.env, NODE_ENV: 'test', DATABASE_URL: DB_URL },
      stdio: 'pipe',
    },
  );

  prisma = new PrismaService({
    get: () => DB_URL,
  } as never);
  await prisma.$connect();

  const user = await prisma.user.create({
    data: {
      email: `billing-sweep-${Date.now()}@test.local`,
      passwordHash: 'not-used',
      name: '账单清扫测试用户',
    },
  });
  userId = user.id;
  const project = await prisma.project.create({
    data: { ownerId: userId, name: '账单清扫回归' },
  });
  projectId = project.id;
}, 60_000);

afterAll(async () => {
  await prisma?.$disconnect().catch(() => undefined);
  rmSync(DB_DIR, { recursive: true, force: true });
});

describe('BillingSweeperService 任务账单清扫', () => {
  it('最老的受保护账单不会占满批次，后续可退款账单仍能继续处理', async () => {
    const protectedTask = await prisma.generationTask.create({
      data: {
        projectId,
        ownerId: userId,
        capability: 'main_image',
        status: 'failed',
        inputAssetIds: '[]',
        params: '{}',
        pendingResult: '{"result":{}}',
      },
    });
    const failedWithRecoveryNoteTask = await prisma.generationTask.create({
      data: {
        projectId,
        ownerId: userId,
        capability: 'main_image',
        status: 'failed',
        inputAssetIds: '[]',
        params: '{}',
        mediaRecoveryError: '普通失败路径写入的错误说明',
      },
    });
    const ordinaryFailedTask = await prisma.generationTask.create({
      data: {
        projectId,
        ownerId: userId,
        capability: 'main_image',
        status: 'failed',
        inputAssetIds: '[]',
        params: '{}',
      },
    });

    const base = Date.now() - 10 * 60_000;
    const protectedOrder = await prisma.billingOrder.create({
      data: {
        userId,
        idempotencyKey: `protected-${base}`,
        taskId: protectedTask.id,
        status: 'reserved',
        createdAt: new Date(base),
      },
    });
    const firstRefundableOrder = await prisma.billingOrder.create({
      data: {
        userId,
        idempotencyKey: `refundable-1-${base}`,
        taskId: failedWithRecoveryNoteTask.id,
        status: 'reserved',
        createdAt: new Date(base + 1_000),
      },
    });
    const secondRefundableOrder = await prisma.billingOrder.create({
      data: {
        userId,
        idempotencyKey: `refundable-2-${base}`,
        taskId: ordinaryFailedTask.id,
        status: 'reserved',
        createdAt: new Date(base + 2_000),
      },
    });

    const refunded: string[] = [];
    const billing = {
      refund: async (id: string) => {
        refunded.push(id);
        await prisma.billingOrder.update({
          where: { id },
          data: { status: 'refunded', refundedAt: new Date() },
        });
      },
    };
    const settings = { getBoolean: async () => true };
    const sweeper = new BillingSweeperService(
      {} as never,
      prisma,
      billing as never,
      settings as never,
    );

    const first = await sweeper.sweep(new Date(), { batchSize: 1 });
    expect(first.taskRefunded).toBe(1);
    expect(refunded).toEqual([firstRefundableOrder.id]);

    const second = await sweeper.sweep(new Date(), { batchSize: 1 });
    expect(second.taskRefunded).toBe(1);
    expect(refunded).toEqual([firstRefundableOrder.id, secondRefundableOrder.id]);

    const protectedAfter = await prisma.billingOrder.findUnique({
      where: { id: protectedOrder.id },
    });
    expect(protectedAfter?.status).toBe('reserved');
  });
});
