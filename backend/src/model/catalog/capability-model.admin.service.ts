/**
 * 能力 ↔ 商品绑定与能力定价后台服务。
 *
 * 前台模型层删除后，这里的写入就是唯一「上架 / 下架」动作：
 *   · 绑定决定某能力能用哪些渠道模型（候选池）；
 *   · 定价决定该能力的对外售价（切换线路不改价）；
 *   · 兼容性预览用能力定义构造规范意图，逐商品跑 `matchCapability`。
 */

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AppError } from '../../common/app.exception';
import { CAPABILITIES, getCapability, defaultCreditCostOf } from '../../capabilities/capability.registry';
import { normalizeCapability } from '../domain/capability-config';
import { badRequest, uniqueNonEmpty } from '../domain/json';
import { matchCapability } from '../intent/capability-match';
import { decodeCapabilityConfig } from '../domain/capability-config';
import { capabilitySpecFromModelCapabilityConfig } from '../intent/capability-spec';
import { CREDIT_SCALE } from '../infra/microcredits';
import { toNumber } from '../channels/channel.presentation';
import { CatalogVersionService } from '../infra/catalog-version.service';
import { CapabilityCatalogService } from '../catalog/capability-catalog.service';
import { RouterService } from '../routing/router.service';
import type { ModelRequestIntent } from '../intent/spec-types';
import type { UserGroupAccess } from '../user-groups/user-group.service';

export interface BindingInput {
  channelModelId: string;
  enabled?: boolean;
  priority?: number;
  weight?: number;
}

export interface PricingInput {
  billingMode?: string;
  unitPriceMicrocredits?: number | string;
  inputTokenPriceMicrocredits?: number | string;
  outputTokenPriceMicrocredits?: number | string;
  cachedTokenPriceMicrocredits?: number | string;
}

const BILLING_MODES = ['fixed_request', 'per_second', 'token'] as const;

type BillingMode = (typeof BILLING_MODES)[number];

@Injectable()
export class CapabilityModelAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalogVersion: CatalogVersionService,
    private readonly catalog: CapabilityCatalogService,
    private readonly router: RouterService,
  ) {}

  /** 某能力的绑定 + 可用于该能力的商品候选 */
  async list(capabilityId: string) {
    const def = this.requireCapability(capabilityId);
    const [bindings, allModels, allChannels] = await Promise.all([
      this.prisma.capabilityModelBinding.findMany({
        where: { capabilityId: def.id },
        orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
      }),
      this.prisma.channelModel.findMany({
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        select: {
          id: true,
          channelId: true,
          modelKey: true,
          modelGroupKey: true,
          displayName: true,
          icon: true,
          capability: true,
          protocol: true,
          capabilityConfigJson: true,
          enabled: true,
          priceConfigured: true,
          deletedAt: true,
        },
      }),
      this.prisma.modelChannel.findMany({
        select: { id: true, name: true, enabled: true, deletedAt: true },
      }),
    ]);
    const channelById = new Map(allChannels.map((row) => [row.id, row]));
    const modelById = new Map(allModels.map((row) => [row.id, row]));
    const models = allModels.filter((row) => !row.deletedAt);

    const rows = bindings.flatMap((binding) => {
      const model = modelById.get(binding.channelModelId);
      if (!model || model.deletedAt) return [];
      const channel = channelById.get(model.channelId);
      return [{
        id: binding.id,
        capabilityId: binding.capabilityId,
        channelModelId: binding.channelModelId,
        modelKey: model.modelKey,
        modelGroupKey: model.modelGroupKey,
        displayName: model.displayName || model.modelKey,
        channelId: model.channelId,
        channelName: channel?.name ?? '',
        enabled: binding.enabled,
        priority: binding.priority,
        weight: binding.weight,
        channelEnabled: Boolean(channel?.enabled && !channel.deletedAt),
        modelEnabled: model.enabled,
        priceConfigured: model.priceConfigured,
        createdAt: binding.createdAt.toISOString(),
      }];
    });
    const invalidBindings = bindings.flatMap((binding) => {
      const model = modelById.get(binding.channelModelId);
      if (model && !model.deletedAt) return [];
      const channel = model ? channelById.get(model.channelId) : undefined;
      return [{
        id: binding.id,
        capabilityId: binding.capabilityId,
        channelModelId: binding.channelModelId,
        displayName: model?.displayName || model?.modelKey || '未知商品',
        modelKey: model?.modelKey ?? '',
        channelId: model?.channelId ?? '',
        channelName: channel?.name ?? '',
        modelDeleted: Boolean(model?.deletedAt || !model),
        enabled: binding.enabled,
        priority: binding.priority,
        weight: binding.weight,
        reason: model?.deletedAt ? '商品已删除' : '商品不存在或已删除',
        createdAt: binding.createdAt.toISOString(),
      }];
    });

    const bound = new Set(rows.map((row) => row.channelModelId));
    const candidates = models
      .filter((model) => normalizeCapability(model.capability) === normalizeCapability(def.model.capability))
      .map((model) => {
        const checked = this.compatibilityOf(def.id, model);
        const channel = channelById.get(model.channelId);
        return {
          channelModelId: model.id,
          modelKey: model.modelKey,
          displayName: model.displayName || model.modelKey,
          icon: model.icon,
          channelId: model.channelId,
          channelName: channel?.name ?? '',
          enabled: model.enabled,
          channelEnabled: Boolean(channel?.enabled && !channel.deletedAt),
          priceConfigured: model.priceConfigured,
          bound: bound.has(model.id),
          compatible: checked.matched,
          reason: checked.reason,
        };
      });

    return {
      capabilityId: def.id,
      bindings: rows,
      invalidBindings,
      invalidCount: invalidBindings.length,
      candidates,
    };
  }

  /**
   * 替换仍有效的绑定。
   *
   * 失效绑定（商品缺失 / 已软删除）不在前端草稿里，也不应该因为保存一次
   * 权重被顺带删除：这类记录是运营排查「能力为什么少了一条线路」的线索。
   * 因此这里只删除本次提交范围内仍然有效的旧绑定，失效项必须通过
   * `pruneInvalid` / `pruneAllInvalid` 显式清理。
   */
  async replace(capabilityId: string, input: BindingInput[]) {
    const def = this.requireCapability(capabilityId);
    const list = Array.isArray(input) ? input : [];
    const ids = uniqueNonEmpty(list.map((item) => item.channelModelId));
    if (ids.length !== list.length) throw badRequest('同一商品不能重复绑定');

    // 同时取出旧绑定引用的商品：只用于判断哪些旧绑定仍有效，不把它们回传给前端。
    const existing = await this.prisma.capabilityModelBinding.findMany({
      where: { capabilityId: def.id },
      select: { id: true, channelModelId: true },
    });
    const referencedIds = uniqueNonEmpty([
      ...ids,
      ...existing.map((row) => row.channelModelId),
    ]);
    const models = referencedIds.length
      ? await this.prisma.channelModel.findMany({
          where: { id: { in: referencedIds }, deletedAt: null },
        })
      : [];
    const modelById = new Map(models.map((row) => [row.id, row]));
    const existingValidIds = existing
      .filter((row) => modelById.has(row.channelModelId))
      .map((row) => row.id);
    for (const item of list) {
      const model = modelById.get(String(item.channelModelId ?? '').trim());
      if (!model) throw badRequest('商品不存在或已删除');
      if (normalizeCapability(model.capability) !== normalizeCapability(def.model.capability)) {
        throw badRequest(`商品 ${model.modelKey} 的能力类型与 ${def.name} 不一致`);
      }
      const checked = this.compatibilityOf(def.id, model);
      if (!checked.matched) throw badRequest(`商品 ${model.modelKey} 不能承接 ${def.name}：${checked.reason}`);
      const weight = Math.trunc(Number(item.weight ?? 100));
      if (!Number.isFinite(weight) || weight <= 0) throw badRequest('权重必须是大于 0 的整数');
      const priority = Math.trunc(Number(item.priority ?? 0));
      if (!Number.isFinite(priority)) throw badRequest('优先级必须是整数');
    }

    await this.prisma.$transaction(async (tx) => {
      if (existingValidIds.length > 0) {
        await tx.capabilityModelBinding.deleteMany({
          where: { capabilityId: def.id, id: { in: existingValidIds } },
        });
      }
      if (list.length > 0) {
        await tx.capabilityModelBinding.createMany({
          data: list.map((item) => ({
            capabilityId: def.id,
            channelModelId: String(item.channelModelId).trim(),
            enabled: item.enabled !== false,
            priority: Math.trunc(Number(item.priority ?? 0)),
            weight: Math.trunc(Number(item.weight ?? 100)),
          })),
        });
      }
    });
    await this.ensurePricing(def.id);
    this.catalogVersion.invalidate();
    return this.list(def.id);
  }

  /** 商品兼容能力预览 */
  async compatibility(channelModelId: string) {
    const model = await this.prisma.channelModel.findFirst({
      where: { id: String(channelModelId ?? '').trim(), deletedAt: null },
    });
    if (!model) throw new AppError(40400, '商品不存在或已删除', 404);
    const modalities = new Set([normalizeCapability(model.capability)]);
    return {
      channelModelId: model.id,
      modelKey: model.modelKey,
      capabilities: CAPABILITIES
        .filter((def) => modalities.has(normalizeCapability(def.model.capability)))
        .map((def) => {
          const checked = this.compatibilityOf(def.id, model);
          return { capabilityId: def.id, name: def.name, matched: checked.matched, reason: checked.reason };
        }),
    };
  }

  /** 商品上架到能力（幂等 upsert） */
  async publish(channelModelId: string, capabilityIds: string[]) {
    const model = await this.prisma.channelModel.findFirst({
      where: { id: String(channelModelId ?? '').trim(), deletedAt: null },
    });
    if (!model) throw new AppError(40400, '商品不存在或已删除', 404);
    const ids = uniqueNonEmpty(capabilityIds);
    if (ids.length === 0) throw badRequest('请选择要绑定的能力');

    const result: Array<{ capabilityId: string; ok: boolean; reason: string }> = [];
    for (const capabilityId of ids) {
      const def = getCapability(capabilityId);
      if (!def) {
        result.push({ capabilityId, ok: false, reason: '未知能力' });
        continue;
      }
      const checked = this.compatibilityOf(def.id, model);
      if (!checked.matched) {
        result.push({ capabilityId, ok: false, reason: checked.reason });
        continue;
      }
      await this.prisma.capabilityModelBinding.upsert({
        where: {
          capabilityId_channelModelId: { capabilityId: def.id, channelModelId: model.id },
        },
        create: { capabilityId: def.id, channelModelId: model.id },
        update: {},
      });
      await this.ensurePricing(def.id);
      result.push({ capabilityId, ok: true, reason: '' });
    }
    this.catalogVersion.invalidate();
    return { channelModelId: model.id, results: result };
  }

  /** 导入后按上游模型键批量绑定（导入弹窗的「同步上架」） */
  async publishByKeys(
    channelId: string,
    capabilitiesByModel: Record<string, string[]>,
  ): Promise<Array<{ modelKey: string; results: Array<{ capabilityId: string; ok: boolean; reason: string }> }>> {
    const entries = Object.entries(capabilitiesByModel ?? {}).filter(([, ids]) => Array.isArray(ids) && ids.length > 0);
    if (entries.length === 0) return [];
    const keys = entries.map(([key]) => key.trim().toLowerCase()).filter(Boolean);
    const models = await this.prisma.channelModel.findMany({
      where: { channelId, activeKey: { in: keys }, deletedAt: null },
    });
    const byKey = new Map(models.map((row) => [String(row.activeKey ?? '').toLowerCase(), row]));
    const result: Array<{ modelKey: string; results: Array<{ capabilityId: string; ok: boolean; reason: string }> }> = [];
    for (const [key, capabilityIds] of entries) {
      const model = byKey.get(key.trim().toLowerCase());
      if (!model) continue;
      const published = await this.publish(model.id, capabilityIds);
      result.push({ modelKey: model.modelKey, results: published.results });
    }
    return result;
  }

  /** 商品被哪些能力消费（渠道台账的影响面提示） */
  async consumption(): Promise<{
    items: Array<{
      channelModelId: string;
      channelId: string;
      modelKey: string;
      capabilityId: string;
      capabilityName: string;
    }>;
  }> {
    const rows = await this.prisma.capabilityModelBinding.findMany({
      orderBy: [{ capabilityId: 'asc' }, { createdAt: 'asc' }],
      select: { channelModelId: true, capabilityId: true },
    });
    const models = rows.length
      ? await this.prisma.channelModel.findMany({
          where: {
            id: { in: [...new Set(rows.map((row) => row.channelModelId))] },
            deletedAt: null,
          },
          select: { id: true, channelId: true, modelKey: true },
        })
      : [];
    const modelById = new Map(models.map((row) => [row.id, row]));
    const items = rows.flatMap((row) => {
      const model = modelById.get(row.channelModelId);
      const capability = getCapability(row.capabilityId);
      if (!model || !capability) return [];
      return [{
        channelModelId: row.channelModelId,
        channelId: model.channelId,
        modelKey: model.modelKey,
        capabilityId: capability.id,
        capabilityName: capability.name,
      }];
    });
    return { items };
  }

  /** 清理指向已删除商品的绑定；只删失效项，不动仍可运行的商品。 */
  async pruneInvalid(capabilityId: string): Promise<{ removed: number }> {
    const def = this.requireCapability(capabilityId);
    const bindings = await this.prisma.capabilityModelBinding.findMany({
      where: { capabilityId: def.id },
      select: { id: true, channelModelId: true },
    });
    if (bindings.length === 0) return { removed: 0 };
    const validModels = await this.prisma.channelModel.findMany({
      where: {
        id: { in: [...new Set(bindings.map((row) => row.channelModelId))] },
        deletedAt: null,
      },
      select: { id: true },
    });
    const valid = new Set(validModels.map((row) => row.id));
    const invalidIds = bindings.filter((row) => !valid.has(row.channelModelId)).map((row) => row.id);
    if (invalidIds.length === 0) return { removed: 0 };
    const result = await this.prisma.capabilityModelBinding.deleteMany({
      where: { capabilityId: def.id, id: { in: invalidIds } },
    });
    if (result.count > 0) this.catalogVersion.invalidate();
    return { removed: result.count };
  }

  /** 跨能力清理全部失效绑定：商品缺失 / 已软删除，或能力定义已不存在。 */
  async pruneAllInvalid(): Promise<{ removed: number }> {
    const bindings = await this.prisma.capabilityModelBinding.findMany({
      select: { id: true, channelModelId: true, capabilityId: true },
    });
    if (bindings.length === 0) return { removed: 0 };
    const validModels = await this.prisma.channelModel.findMany({
      where: {
        id: { in: [...new Set(bindings.map((row) => row.channelModelId))] },
        deletedAt: null,
      },
      select: { id: true },
    });
    const validModelIds = new Set(validModels.map((row) => row.id));
    const invalidIds = bindings
      .filter((row) => !validModelIds.has(row.channelModelId) || !getCapability(row.capabilityId))
      .map((row) => row.id);
    if (invalidIds.length === 0) return { removed: 0 };
    const result = await this.prisma.capabilityModelBinding.deleteMany({
      where: { id: { in: invalidIds } },
    });
    if (result.count > 0) this.catalogVersion.invalidate();
    return { removed: result.count };
  }

  /* ── 定价 ── */

  async getPricing(capabilityId: string) {
    const def = this.requireCapability(capabilityId);
    const row = await this.prisma.capabilityPricing.findUnique({ where: { capabilityId: def.id } });
    const defaultBillingMode: BillingMode =
      normalizeCapability(def.model.capability) === 'text' ? 'token' : 'fixed_request';
    const defaultUnitPriceMicrocredits =
      defaultBillingMode === 'fixed_request' ? Number(CREDIT_SCALE) * defaultCreditCostOf(def.id) : 0;
    if (!row) {
      return {
        capabilityId: def.id,
        billingMode: defaultBillingMode,
        unitPriceMicrocredits: defaultUnitPriceMicrocredits,
        inputTokenPriceMicrocredits: 0,
        outputTokenPriceMicrocredits: 0,
        cachedTokenPriceMicrocredits: 0,
        configured: false,
        source: 'default' as const,
        defaultUnitPriceMicrocredits,
        updatedBy: null,
        updatedAt: null,
      };
    }
    return {
      capabilityId: row.capabilityId,
      billingMode: row.billingMode,
      unitPriceMicrocredits: toNumber(row.unitPriceMicrocredits),
      inputTokenPriceMicrocredits: toNumber(row.inputTokenPriceMicrocredits),
      outputTokenPriceMicrocredits: toNumber(row.outputTokenPriceMicrocredits),
      cachedTokenPriceMicrocredits: toNumber(row.cachedTokenPriceMicrocredits),
      configured: true,
      source: 'capability_pricing' as const,
      defaultUnitPriceMicrocredits,
      updatedBy: row.updatedBy || null,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async setPricing(capabilityId: string, input: PricingInput, actor: string) {
    const def = this.requireCapability(capabilityId);
    const billingMode = String(input.billingMode ?? 'fixed_request').trim() as BillingMode;
    if (!(BILLING_MODES as readonly string[]).includes(billingMode)) {
      throw badRequest('计费方式仅支持按次、按秒或 Token');
    }
    const amount = (value: number | string | undefined, label: string): bigint => {
      const text = value === undefined || value === null || value === '' ? '0' : String(value);
      if (!/^\d+$/.test(text)) throw badRequest(`${label}必须是非负整数（微积分）`);
      const parsed = BigInt(text);
      if (parsed > BigInt(Number.MAX_SAFE_INTEGER)) throw badRequest(`${label}超出安全范围`);
      return parsed;
    };
    const rawUnit = amount(input.unitPriceMicrocredits, '单次价格');
    const rawInputTokens = amount(input.inputTokenPriceMicrocredits, '输入 Token 价格');
    const rawOutputTokens = amount(input.outputTokenPriceMicrocredits, '输出 Token 价格');
    const rawCachedTokens = amount(input.cachedTokenPriceMicrocredits, '缓存 Token 价格');
    if (billingMode === 'token' && rawInputTokens === 0n && rawOutputTokens === 0n && rawCachedTokens === 0n) {
      throw badRequest('Token 计费必须至少配置一项 Token 价格');
    }
    if (billingMode !== 'token' && rawUnit === 0n) {
      throw badRequest(billingMode === 'per_second' ? '每秒价格必须大于 0' : '按次计费的价格必须大于 0');
    }
    // 一套定价只保留当前计费模式相关字段，避免切换模式后旧字段继续参与展示或财务口径。
    const unit = billingMode === 'token' ? 0n : rawUnit;
    const inputTokens = billingMode === 'token' ? rawInputTokens : 0n;
    const outputTokens = billingMode === 'token' ? rawOutputTokens : 0n;
    const cachedTokens = billingMode === 'token' ? rawCachedTokens : 0n;
    const row = await this.prisma.capabilityPricing.upsert({
      where: { capabilityId: def.id },
      create: {
        capabilityId: def.id,
        billingMode,
        unitPriceMicrocredits: unit,
        inputTokenPriceMicrocredits: inputTokens,
        outputTokenPriceMicrocredits: outputTokens,
        cachedTokenPriceMicrocredits: cachedTokens,
        updatedBy: actor,
      },
      update: {
        billingMode,
        unitPriceMicrocredits: unit,
        inputTokenPriceMicrocredits: inputTokens,
        outputTokenPriceMicrocredits: outputTokens,
        cachedTokenPriceMicrocredits: cachedTokens,
        updatedBy: actor,
      },
    });
    this.catalogVersion.invalidate();
    return this.getPricing(row.capabilityId);
  }

  /* ── 模拟 ── */

  async simulate(access: UserGroupAccess | null, capabilityId: string, body: {
    modelKey?: string;
    inputs?: unknown;
    options?: unknown;
  }): Promise<Awaited<ReturnType<RouterService['simulate']>>> {
    const def = this.requireCapability(capabilityId);
    const intent: ModelRequestIntent = {
      capability: normalizeCapability(def.model.capability),
      operation: def.model.operation,
      inputs: (body.inputs as Record<string, number>) ?? { image: def.inputs, video: 0 },
      options: (body.options as Record<string, unknown>) ?? {},
    };
    return this.router.simulate(access, def.id, intent, String(body.modelKey ?? '').trim());
  }

  /* ── 内部 ── */

  private requireCapability(capabilityId: string) {
    const def = getCapability(String(capabilityId ?? '').trim());
    if (!def) throw new AppError(40400, '能力不存在', 404);
    return def;
  }

  private compatibilityOf(capabilityId: string, model: {
    modelKey: string;
    capability: string;
    protocol: string;
    capabilityConfigJson: string;
  }): { matched: boolean; reason: string } {
    const def = getCapability(capabilityId);
    if (!def) return { matched: false, reason: '未知能力' };
    if (normalizeCapability(model.capability) !== normalizeCapability(def.model.capability)) {
      return { matched: false, reason: '商品能力类型与能力不一致' };
    }
    let spec;
    try {
      spec = capabilitySpecFromModelCapabilityConfig(
        decodeCapabilityConfig(model.capabilityConfigJson),
        model.capability,
        model.protocol,
      );
    } catch (error) {
      return { matched: false, reason: `商品能力配置非法：${(error as Error).message}` };
    }
    const intent = def.model.intent({}, { image: def.inputs, video: 0 });
    const matched = matchCapability(spec, intent);
    return { matched: matched.matched, reason: matched.reasons[0] ?? '' };
  }

  /** 首次绑定时补一条默认固定价，保证能力可售；Token 能力保持未配置 */
  private async ensurePricing(capabilityId: string): Promise<void> {
    const existing = await this.prisma.capabilityPricing.findUnique({ where: { capabilityId } });
    if (existing) return;
    const def = getCapability(capabilityId);
    if (!def) return;
    if (normalizeCapability(def.model.capability) === 'text') return;
    const credits = defaultCreditCostOf(capabilityId);
    await this.prisma.capabilityPricing.create({
      data: {
        capabilityId,
        billingMode: 'fixed_request',
        unitPriceMicrocredits: BigInt(credits) * CREDIT_SCALE,
      },
    }).catch(() => undefined);
  }
}
