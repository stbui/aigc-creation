/**
 * 渠道模型持久化 —— 需要事务语义的写路径集中在这里。
 *
 * 三处必须原子：
 *   1. 渠道模型与它的全部价格档同时落库（不能出现「能力已开放、新价格还没写」的窗口）；
 *   2. 删除模型时同步刷新渠道的 `modelsJson` 兼容清单；
 *   3. 排序写入前用 `expectedIds` 做 CAS，避免两个管理员互相覆盖。
 *
 * SQLite 下 Prisma 的交互式事务是串行的，不需要 `SELECT ... FOR UPDATE`；
 * 并发正确性靠唯一键与 `expectedIds` 比对。
 */

import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';

/** 事务客户端（Prisma 交互式事务里的 tx） */
export type PrismaTx = Prisma.TransactionClient;

/** 渠道不存在（软删除后不可再写入） */
export class ChannelNotFoundError extends Error {
  constructor() {
    super('系统渠道不存在或已删除');
    this.name = 'ChannelNotFoundError';
  }
}

/** 渠道模型被前台模型路线或进行中任务引用 */
export class ChannelModelInUseError extends Error {
  constructor() {
    super('所选渠道模型中有模型仍被前台模型供应线路或进行中任务使用，本次未删除任何模型');
    this.name = 'ChannelModelInUseError';
  }
}

/** 排序列表已变化（另一个管理员先保存了） */
export class ChannelOrderChangedError extends Error {
  constructor() {
    super('排序列表已变化，请重新加载后再保存');
    this.name = 'ChannelOrderChangedError';
  }
}

export interface PriceTierWrite {
  selectorKey: string;
  selectorJson: string;
  resolution: string;
  videoSeconds: number;
  providerModelKey: string;
  billingMode: string;
  costConfigured: boolean;
  costUnitPriceMicrocredits: bigint;
  costInputTokenPriceMicrocredits: bigint;
  costOutputTokenPriceMicrocredits: bigint;
  costCachedTokenPriceMicrocredits: bigint;
  unitPriceMicrocredits: bigint;
  inputTokenPriceMicrocredits: bigint;
  outputTokenPriceMicrocredits: bigint;
  cachedTokenPriceMicrocredits: bigint;
  priceConfigured: boolean;
  enabled: boolean;
}

/** 从已落库（或即将落库）的模型行重建渠道兼容清单 `modelsJson` */
export async function refreshChannelModelNames(tx: PrismaTx, channelId: string): Promise<void> {
  const rows = await tx.channelModel.findMany({
    where: { channelId, enabled: true, deletedAt: null },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    select: { modelKey: true },
  });
  await tx.modelChannel.updateMany({
    where: { id: channelId },
    data: { modelsJson: JSON.stringify(rows.map((row) => row.modelKey)) },
  });
}

export interface SaveChannelModelInput {
  /** 现有渠道模型 id；新建时留空 */
  channelModelId?: string;
  /** 新建渠道模型的行数据（channelModelId 为空时必须提供） */
  create?: Prisma.ChannelModelUncheckedCreateInput;
  /** 保存后写回模型行的摘要字段（新建时留空，由 create 提供初始值） */
  update?: Prisma.ChannelModelUncheckedUpdateInput;
  tiers: PriceTierWrite[];
}

/**
 * 保存渠道模型与价格档。
 *
 * 价格档按 `selectorKey` 幂等：同一个规格重复保存只升 `priceVersion`，
 * 不换 id —— 否则后台表格的「档位」行会在每次保存后跳动。
 */
export async function saveChannelModelWithPriceTiers(
  tx: PrismaTx,
  input: SaveChannelModelInput,
): Promise<string> {
  let channelModelId = String(input.channelModelId ?? '').trim();
  const existing = channelModelId
    ? await tx.channelModelPriceTier.findMany({ where: { channelModelId, deletedAt: null } })
    : [];
  if (!channelModelId) {
    if (!input.create) throw new ChannelNotFoundError();
    const created = await tx.channelModel.create({ data: input.create });
    channelModelId = created.id;
  }
  const existingByKey = new Map(existing.map((row) => [row.selectorKey, row]));
  const selected = new Set<string>();

  for (const tier of input.tiers) {
    const previous = existingByKey.get(tier.selectorKey);
    const data = {
      activeKey: tier.selectorKey,
      selectorKey: tier.selectorKey,
      selectorJson: tier.selectorJson,
      resolution: tier.resolution,
      videoSeconds: tier.videoSeconds,
      providerModelKey: tier.providerModelKey,
      billingMode: tier.billingMode,
      costConfigured: tier.costConfigured,
      costUnitPriceMicrocredits: tier.costUnitPriceMicrocredits,
      costInputTokenPriceMicrocredits: tier.costInputTokenPriceMicrocredits,
      costOutputTokenPriceMicrocredits: tier.costOutputTokenPriceMicrocredits,
      costCachedTokenPriceMicrocredits: tier.costCachedTokenPriceMicrocredits,
      unitPriceMicrocredits: tier.unitPriceMicrocredits,
      inputTokenPriceMicrocredits: tier.inputTokenPriceMicrocredits,
      outputTokenPriceMicrocredits: tier.outputTokenPriceMicrocredits,
      cachedTokenPriceMicrocredits: tier.cachedTokenPriceMicrocredits,
      priceConfigured: tier.priceConfigured,
      enabled: tier.enabled,
    };
    if (previous) {
      await tx.channelModelPriceTier.update({
        where: { id: previous.id },
        data: { ...data, priceVersion: previous.priceVersion + 1 },
      });
      selected.add(previous.id);
      continue;
    }
    const created = await tx.channelModelPriceTier.create({
      data: { ...data, channelModelId, priceVersion: 1 },
    });
    selected.add(created.id);
  }

  for (const row of existing) {
    if (selected.has(row.id)) continue;
    await tx.channelModelPriceTier.update({
      where: { id: row.id },
      data: { deletedAt: new Date(), activeKey: null, enabled: false },
    });
  }

  if (input.update) {
    await tx.channelModel.update({ where: { id: channelModelId }, data: input.update });
  }
  return channelModelId;
}

/**
 * 批量删除渠道模型。
 *
 * 先整体校验再删除：**不允许部分成功**。管理员改掉冲突项后可以原样重试同一次选择，
 * 而部分成功会让「我删了 3 个、剩下 1 个还在」变成需要逐条核对的谜题。
 */
export async function deleteChannelModels(
  tx: PrismaTx,
  channelId: string,
  ids: string[],
): Promise<number> {
  const unique = [...new Set(ids.map((id) => String(id ?? '').trim()).filter(Boolean))];
  if (unique.length === 0) throw new ChannelNotFoundError();

  const existing = await tx.channelModel.findMany({
    where: { channelId, id: { in: unique }, deletedAt: null },
    select: { id: true },
  });
  if (existing.length !== unique.length) throw new ChannelNotFoundError();

  // 前台模型生效中的 revision 仍引用这些渠道模型时不允许删除
  const activeRevisions = await tx.logicalModel.findMany({
    where: { archivedAt: null, activeRevisionId: { not: '' } },
    select: { activeRevisionId: true },
  });
  const revisionIds = activeRevisions.map((row) => row.activeRevisionId);
  if (revisionIds.length > 0) {
    const references = await tx.logicalModelRoute.count({
      where: { logicalModelRevisionId: { in: revisionIds }, channelModelId: { in: unique } },
    });
    if (references > 0) throw new ChannelModelInUseError();
  }
  // 进行中任务引用：排队 / 执行中的任务正在用这些线路，删掉会让任务派发失败、
  // 上游已消耗成本而用户只能退款。任务表已有 channelModelId 列，这里做真实校验。
  const runningTasks = await tx.generationTask.count({
    where: {
      channelModelId: { in: unique },
      status: { in: ['queued', 'running'] },
    },
  });
  if (runningTasks > 0) throw new ChannelModelInUseError();

  const now = new Date();
  await tx.channelModelPriceTier.updateMany({
    where: { channelModelId: { in: unique }, deletedAt: null },
    data: { deletedAt: now, activeKey: null, enabled: false },
  });
  const result = await tx.channelModel.updateMany({
    where: { channelId, id: { in: unique }, deletedAt: null },
    data: { deletedAt: now, activeKey: null, enabled: false, priceVersion: { increment: 1 } },
  });
  await refreshChannelModelNames(tx, channelId);
  return result.count;
}

/**
 * 排序 CAS：`expectedIds` 必须与库中当前顺序完全一致。
 * 顺序读取与写入在同一事务内，避免读到「别人改到一半」的列表。
 */
export async function saveChannelOrder(
  tx: PrismaTx,
  channelId: string,
  ids: string[],
  expectedIds: string[],
): Promise<void> {
  const isChannelLevel = !channelId;
  const current = isChannelLevel
    ? await tx.modelChannel.findMany({
        where: { scope: 'system', deletedAt: null },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
        select: { id: true },
      })
    : await tx.channelModel.findMany({
        where: { channelId, deletedAt: null },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
        select: { id: true },
      });
  const currentIds = current.map((row) => row.id);
  if (currentIds.length !== expectedIds.length || currentIds.some((id, index) => id !== expectedIds[index])) {
    throw new ChannelOrderChangedError();
  }
  if (ids.length !== currentIds.length || new Set(ids).size !== currentIds.length) {
    throw new ChannelOrderChangedError();
  }
  const allowed = new Set(currentIds);
  for (const id of ids) if (!allowed.has(id)) throw new ChannelOrderChangedError();

  const now = new Date();
  for (let index = 0; index < ids.length; index += 1) {
    if (isChannelLevel) {
      await tx.modelChannel.update({ where: { id: ids[index] }, data: { sortOrder: index, updatedAt: now } });
    } else {
      await tx.channelModel.update({ where: { id: ids[index] }, data: { sortOrder: index, updatedAt: now } });
    }
  }
  if (!isChannelLevel) await refreshChannelModelNames(tx, channelId);
}
