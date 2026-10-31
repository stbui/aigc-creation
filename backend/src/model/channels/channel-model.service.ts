/**
 * 渠道模型服务 —— 渠道内的可执行上游 SKU（能力合同 + 价格档 + 启停排序）。
 *
 * 与参考实现逐条对齐的保存顺序（顺序本身是校验的一部分）：
 *   1. 标签 / 描述等展示字段先校验；
 *   2. 协议必须存在、必须是生成类、必须支持该能力（能力匹配不看协议名）；
 *   3. **同渠道重复模型优先报错**，避免无关的能力校验掩盖真正的冲突；
 *   4. 能力配置归一化 → 价格档规范化与计价校验 → 档位落在能力合同内；
 *   5. 模型与全部价格档同一事务落库，再刷新渠道兼容清单。
 *
 * 模型级上游键改名时会级联跟随「与旧值相同」的档位键：那些档位是保存时
 * 隐式固化的默认值，不跟随就会继续把旧 SKU 发给供应商。
 */

import { HttpStatus, Injectable } from '@nestjs/common';
import type { ModelChannel, Prisma } from '@prisma/client';
import { AppError } from '../../common/app.exception';
import { PrismaService } from '../../prisma/prisma.service';
import { normalizeCapability, normalizeModelCapabilityConfig } from '../domain/capability-config';
import type { ImageParameter } from '../domain/image-parameters';
import { badRequest, normalizeModelKey, toSafeAmount, uniqueNonEmpty } from '../domain/json';
import {
  applyChannelModelPriceTierSummary,
  canonicalSkuSelector,
  normalizeChannelModelTierSelector,
  validateChannelModelTierCapabilities,
  validateChannelModelTierPricing,
} from '../domain/selector';
import { CatalogVersionService } from '../infra/catalog-version.service';
import { ProtocolCatalogService } from '../protocol/protocol-catalog.service';
import {
  ChannelModelInUseError,
  ChannelNotFoundError,
  type PriceTierWrite,
  deleteChannelModels,
  refreshChannelModelNames,
  saveChannelModelWithPriceTiers,
} from './channel-model.repository';
import {
  channelModelActiveKey,
  channelModelView,
  normalizeChannelModelTags,
  normalizePriceCurrency,
  retiredChannelModelKeys,
  toNumber,
} from './channel.presentation';
import {
  CHANNEL_SCOPE_SYSTEM,
  MAX_CHANNEL_MODEL_BATCH_DELETE,
  MAX_SORT_ORDER,
  type ChannelModelPriceTierRequest,
  type ChannelModelRequest,
  type ChannelModelView,
} from './channel.types';

/** 支持能力合同的能力（audio 暂无协议实现，不落能力配置） */
const CONFIGURABLE_CAPABILITIES = ['text', 'image', 'video'];

function channelNotFound(): AppError {
  return new AppError(40400, '系统渠道不存在或已删除', HttpStatus.NOT_FOUND);
}

function modelNotFound(): AppError {
  return new AppError(40400, '渠道模型不存在或已删除', HttpStatus.NOT_FOUND);
}

@Injectable()
export class ChannelModelService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly protocols: ProtocolCatalogService,
    private readonly catalogVersion: CatalogVersionService,
  ) {}

  /* ───────────────────────── 查询 ───────────────────────── */

  /** 后台列表：模型 + 价格档投影 */
  async list(channelId: string): Promise<ChannelModelView[]> {
    await this.requireChannel(channelId);
    const rows = await this.ensureChannelModels(channelId, true);
    const tiers =
      rows.length > 0
        ? await this.prisma.channelModelPriceTier.findMany({
            where: { channelModelId: { in: rows.map((row) => row.id) }, deletedAt: null },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          })
        : [];
    return rows.map((row) => channelModelView(row, tiers.filter((tier) => tier.channelModelId === row.id)));
  }

  /** 跨渠道模型列表（全量模型页）；`channelId` 给出时只查该渠道 */
  async listAll(channelId?: string): Promise<ChannelModelView[]> {
    const rows = await this.prisma.channelModel.findMany({
      where: { deletedAt: null, enabled: true, ...(channelId ? { channelId } : {}) },
      orderBy: [{ channelId: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    const tiers =
      rows.length > 0
        ? await this.prisma.channelModelPriceTier.findMany({
            where: { channelModelId: { in: rows.map((row) => row.id) }, deletedAt: null },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          })
        : [];
    return rows.map((row) => channelModelView(row, tiers.filter((tier) => tier.channelModelId === row.id)));
  }

  /** 按模型标识查（含停用，不含已删除） */
  async findByKey(channelId: string, modelKey: string) {
    const key = channelModelActiveKey(modelKey);
    if (!key) return null;
    return this.prisma.channelModel.findFirst({ where: { channelId, activeKey: key, deletedAt: null } });
  }

  /* ───────────────────────── 保存 ───────────────────────── */

  async save(channelId: string, id: string, req: ChannelModelRequest): Promise<ChannelModelView> {
    const channel = await this.requireChannel(channelId);
    const channelLabelInput = String(req.channelLabel ?? '').trim();
    const tags = normalizeChannelModelTags(req.tags ?? []);
    const description = String(req.description ?? '').trim();
    if ([...description].length > 500) throw badRequest('模型描述不能超过 500 字');

    const contract = this.normalizeContract(channel, req);
    const { modelKey, providerModelKey, capability, protocol } = contract;
    const channelLabel = channelLabelInput === providerModelKey ? '' : channelLabelInput;
    if ([...channelLabel].length > 80) throw badRequest('渠道展示名不能超过 80 字');

    // 先查同渠道重复模型：能力或价格配置的错误不应掩盖「这个模型已存在」
    const conflict = await this.findByKey(channelId, modelKey);
    if (conflict && conflict.id !== String(id ?? '').trim()) {
      throw badRequest(`该渠道已存在模型 ${modelKey}，请直接编辑已有模型`);
    }

    const existing = id ? await this.requireModel(channelId, id) : null;
    const capabilityConfig = CONFIGURABLE_CAPABILITIES.includes(capability)
      ? normalizeModelCapabilityConfig({
          capability,
          protocol,
          model: providerModelKey,
          input: req.capabilityConfig ?? null,
        })
      : null;
    const capabilityConfigJson = capabilityConfig ? JSON.stringify(capabilityConfig) : '';

    const tiers = this.normalizePriceTiers(req, capability, providerModelKey);
    const previousProviderModelKey = existing ? normalizeModelKey(existing.providerModelKey) : '';
    if (previousProviderModelKey && providerModelKey !== previousProviderModelKey) {
      for (const tier of tiers) {
        if (normalizeModelKey(tier.providerModelKey) === previousProviderModelKey) {
          tier.providerModelKey = providerModelKey;
        }
      }
    }

    validateChannelModelTierCapabilities(
      tiers.map((tier) => ({
        selector: JSON.parse(tier.selectorJson) as Record<string, string>,
        resolution: tier.resolution,
        videoSeconds: tier.videoSeconds,
      })),
      capabilityConfigJson,
      capability,
      protocol,
    );

    let capabilityVersion = existing?.capabilityVersion ?? 0;
    if (capabilityConfigJson) {
      if (existing && existing.capabilityConfigJson !== capabilityConfigJson) capabilityVersion += 1;
      else if (!existing) capabilityVersion = 1;
    } else {
      capabilityVersion = 0;
    }

    let priceCurrency = '';
    if (req.priceCurrency !== undefined && req.priceCurrency !== null) {
      priceCurrency = normalizePriceCurrency(req.priceCurrency);
    }

    const summary = summarizeTiers(tiers);
    const modelFields = {
      modelKey,
      activeKey: channelModelActiveKey(modelKey),
      providerModelKey,
      displayName: String(req.displayName ?? '').trim() || '未分类',
      channelLabel,
      tags: JSON.stringify(tags),
      description,
      icon: String(req.icon ?? '').trim(),
      capability,
      protocol,
      billingMode: summary.billingMode,
      unitPriceMicrocredits: BigInt(summary.unitPriceMicrocredits),
      inputTokenPriceMicrocredits: BigInt(summary.inputTokenPriceMicrocredits),
      outputTokenPriceMicrocredits: BigInt(summary.outputTokenPriceMicrocredits),
      cachedTokenPriceMicrocredits: BigInt(summary.cachedTokenPriceMicrocredits),
      priceConfigured: summary.priceConfigured,
      priceVersion: existing ? existing.priceVersion + 1 : 1,
      priceCurrency: priceCurrency || existing?.priceCurrency || 'credits',
      capabilityConfigJson,
      capabilityVersion,
      enabled: req.enabled === undefined || req.enabled === null ? (existing?.enabled ?? true) : Boolean(req.enabled),
    };

    const savedId = await this.prisma.$transaction(async (tx) => {
      const modelId = await saveChannelModelWithPriceTiers(tx, {
        channelModelId: existing?.id,
        create: existing
          ? undefined
          : ({ ...modelFields, channelId, sortOrder: 0 } as Prisma.ChannelModelUncheckedCreateInput),
        update: existing ? (modelFields as Prisma.ChannelModelUncheckedUpdateInput) : undefined,
        tiers,
      });
      await refreshChannelModelNames(tx, channelId);
      return modelId;
    });
    await this.catalogVersion.invalidate();

    const row = await this.prisma.channelModel.findUnique({ where: { id: savedId } });
    const tierRows = await this.prisma.channelModelPriceTier.findMany({
      where: { channelModelId: savedId, deletedAt: null },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return channelModelView(row!, tierRows);
  }

  async setEnabled(channelId: string, id: string, enabled: boolean): Promise<void> {
    const model = await this.requireModel(channelId, id);
    await this.prisma.$transaction(async (tx) => {
      await tx.channelModel.update({
        where: { id: model.id },
        data: { enabled: Boolean(enabled), priceVersion: model.priceVersion + 1 },
      });
      await refreshChannelModelNames(tx, channelId);
    });
    await this.catalogVersion.invalidate();
  }

  /** 排序只改展示顺序，不重写价格、能力版本或模型标识 */
  async updateSort(channelId: string, id: string, sortOrder: number): Promise<void> {
    const value = Number(sortOrder);
    if (!Number.isInteger(value) || value < 0 || value > MAX_SORT_ORDER) {
      throw badRequest('排序值必须是 0-999999 的整数，数值越小越靠前');
    }
    const model = await this.requireModel(channelId, id);
    await this.prisma.$transaction(async (tx) => {
      await tx.channelModel.update({ where: { id: model.id }, data: { sortOrder: value } });
      await refreshChannelModelNames(tx, channelId);
    });
    await this.catalogVersion.invalidate();
  }

  /**
   * 批量删除。先整体校验再删除，**不允许部分成功**。
   */
  async removeMany(channelId: string, ids: string[]): Promise<number> {
    await this.requireChannel(channelId);
    const unique = normalizeDeleteIds(ids);
    const existing = await this.prisma.channelModel.findMany({
      where: { channelId, id: { in: unique }, deletedAt: null },
      select: { id: true },
    });
    if (existing.length !== unique.length) {
      throw badRequest('所选渠道模型中存在已删除或不属于当前渠道的记录，请刷新后重试');
    }
    let deleted = 0;
    try {
      await this.prisma.$transaction(async (tx) => {
        deleted = await deleteChannelModels(tx, channelId, unique);
      });
    } catch (error) {
      if (error instanceof ChannelModelInUseError) {
        throw badRequest('所选渠道模型中有模型仍被前台模型供应线路或进行中任务使用，本次未删除任何模型');
      }
      if (error instanceof ChannelNotFoundError) throw modelNotFound();
      throw error;
    }
    await this.catalogVersion.invalidate();
    return deleted;
  }

  /* ───────────────────────── 初始化 ───────────────────────── */

  /** 渠道最早只有上游模型名清单时，按它补出停用状态的骨架行 */
  async syncInitialChannelModels(channel: ModelChannel, names: string[]): Promise<void> {
    const existing = await this.prisma.channelModel.findMany({
      where: { channelId: channel.id, deletedAt: null },
    });
    const byKey = new Map(existing.map((row) => [row.activeKey ?? channelModelActiveKey(row.modelKey), row]));
    const retired = retiredChannelModelKeys(channel.retiredModelsJson);
    const desired = new Set<string>();

    await this.prisma.$transaction(async (tx) => {
      for (const raw of uniqueNonEmpty(names)) {
        const name = normalizeModelKey(raw);
        if (!name) continue;
        const key = channelModelActiveKey(name);
        if (retired.has(key)) continue;
        desired.add(key);
        if (byKey.has(key)) continue;
        await tx.channelModel.create({
          data: {
            channelId: channel.id,
            modelKey: name,
            activeKey: key,
            providerModelKey: name,
            displayName: '未分类',
            capability: '',
            protocol: '',
            billingMode: 'fixed_request',
            enabled: false,
            priceConfigured: false,
            priceVersion: 1,
          },
        });
      }
      for (const row of existing) {
        const key = row.activeKey ?? channelModelActiveKey(row.modelKey);
        if (desired.has(key) || !row.enabled) continue;
        await tx.channelModel.update({
          where: { id: row.id },
          data: { enabled: false, priceVersion: row.priceVersion + 1 },
        });
      }
    });
  }

  /** 渠道一个模型都没有时，按 `modelsJson` 补一次骨架行 */
  async ensureChannelModels(channelId: string, includeDisabled: boolean) {
    const rows = await this.prisma.channelModel.findMany({
      where: { channelId, deletedAt: null, ...(includeDisabled ? {} : { enabled: true }) },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    });
    if (rows.length > 0) return rows;
    const channel = await this.requireChannel(channelId);
    const names = decodeNameList(channel.modelsJson);
    if (names.length === 0) return rows;
    await this.syncInitialChannelModels(channel, names);
    return this.prisma.channelModel.findMany({
      where: { channelId, deletedAt: null, ...(includeDisabled ? {} : { enabled: true }) },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    });
  }

  /* ───────────────────────── 内部 ───────────────────────── */

  private async requireChannel(channelId: string): Promise<ModelChannel> {
    const id = String(channelId ?? '').trim();
    if (!id) throw channelNotFound();
    const row = await this.prisma.modelChannel.findFirst({
      where: { id, scope: CHANNEL_SCOPE_SYSTEM, deletedAt: null },
    });
    if (!row) throw channelNotFound();
    return row;
  }

  private async requireModel(channelId: string, id: string) {
    const modelId = String(id ?? '').trim();
    if (!modelId) throw modelNotFound();
    const row = await this.prisma.channelModel.findFirst({
      where: { id: modelId, channelId, deletedAt: null },
    });
    if (!row) throw modelNotFound();
    return row;
  }

  /**
   * 模型与协议的绑定校验。
   *
   * 协议能力匹配看 `capability` 而不是协议名；需要 Secret Key 的协议
   * （aws-bedrock / 腾讯 TC3 / 火山 v4）在保存时就要求渠道配好双凭证，
   * 否则这条线路建成之后必然失败。
   */
  private normalizeContract(channel: ModelChannel, req: ChannelModelRequest) {
    const modelKey = normalizeModelKey(req.modelKey ?? '');
    if (!modelKey) throw badRequest('请填写模型标识');
    const providerModelKey = normalizeModelKey(req.providerModelKey ?? '') || modelKey;
    const capability = normalizeCapability(req.capability);
    if (!capability) throw badRequest('请选择模型能力');
    const protocolId = String(req.protocol ?? '').trim();
    if (!protocolId) throw badRequest('请选择有效的模型请求协议');

    const protocol = this.protocols.require(protocolId, capability);
    if (protocol.requiresSecretKey && String(channel.secretKey ?? '').trim() === '') {
      throw badRequest(`${protocol.label} 需要先在渠道中配置 Access Key 与 Secret Key`);
    }
    return { modelKey, providerModelKey, capability, protocol: protocol.id };
  }

  /**
   * 价格档规范化。
   *
   * 没有提交 priceTiers 等价于一个通配档（兼容旧表单）；选择器规范化后按
   * `selectorKey` 去重，同一规格组合只允许一个档位。
   */
  private normalizePriceTiers(
    req: ChannelModelRequest,
    capability: string,
    fallbackProviderModelKey: string,
  ): PriceTierWrite[] {
    const imageParameters: ImageParameter[] | undefined =
      capability === 'image' ? req.capabilityConfig?.image?.parameters : undefined;
    const inputs: ChannelModelPriceTierRequest[] =
      req.priceTiers && req.priceTiers.length > 0
        ? req.priceTiers
        : [
            {
              selector: null,
              resolution: '*',
              videoSeconds: 0,
              providerModelKey: fallbackProviderModelKey,
              billingMode: req.billingMode,
              unitPriceMicrocredits: req.unitPriceMicrocredits,
              inputTokenPriceMicrocredits: req.inputTokenPriceMicrocredits,
              outputTokenPriceMicrocredits: req.outputTokenPriceMicrocredits,
              cachedTokenPriceMicrocredits: req.cachedTokenPriceMicrocredits,
              priceConfigured: req.priceConfigured,
              enabled: true,
            },
          ];

    const result: PriceTierWrite[] = [];
    const seen = new Set<string>();
    for (const input of inputs) {
      const normalized = normalizeChannelModelTierSelector(
        capability,
        { selector: input.selector ?? null, resolution: input.resolution ?? null, videoSeconds: input.videoSeconds ?? null },
        imageParameters,
      );
      const canonical = canonicalSkuSelector(normalized.selector);
      if (seen.has(canonical.key)) throw badRequest('同一个操作和规格组合只能配置一个价格档');
      seen.add(canonical.key);

      const billingMode = String(input.billingMode ?? '').trim() || 'fixed_request';
      const prices = {
        billingMode,
        unitPriceMicrocredits: toSafeAmount(input.unitPriceMicrocredits, '模型积分价格'),
        inputTokenPriceMicrocredits: toSafeAmount(input.inputTokenPriceMicrocredits, '输入 Token 价格'),
        outputTokenPriceMicrocredits: toSafeAmount(input.outputTokenPriceMicrocredits, '输出 Token 价格'),
        cachedTokenPriceMicrocredits: toSafeAmount(input.cachedTokenPriceMicrocredits, '缓存 Token 价格'),
      };
      const costInput = input.costPricing ?? {};
      const cost = {
        billingMode,
        configured: Boolean(costInput.configured),
        unitPriceMicrocredits: toSafeAmount(costInput.unitPriceMicrocredits, '积分成本价'),
        inputTokenPriceMicrocredits: toSafeAmount(costInput.inputTokenPriceMicrocredits, '输入 Token 成本价'),
        outputTokenPriceMicrocredits: toSafeAmount(costInput.outputTokenPriceMicrocredits, '输出 Token 成本价'),
        cachedTokenPriceMicrocredits: toSafeAmount(costInput.cachedTokenPriceMicrocredits, '缓存 Token 成本价'),
      };
      validateChannelModelTierPricing(capability, billingMode, prices, cost);

      result.push({
        selectorKey: canonical.key,
        selectorJson: canonical.key,
        resolution: normalized.resolution,
        videoSeconds: normalized.videoSeconds,
        providerModelKey: normalizeModelKey(input.providerModelKey ?? '') || fallbackProviderModelKey,
        billingMode,
        costConfigured: cost.configured,
        costUnitPriceMicrocredits: BigInt(cost.unitPriceMicrocredits),
        costInputTokenPriceMicrocredits: BigInt(cost.inputTokenPriceMicrocredits),
        costOutputTokenPriceMicrocredits: BigInt(cost.outputTokenPriceMicrocredits),
        costCachedTokenPriceMicrocredits: BigInt(cost.cachedTokenPriceMicrocredits),
        unitPriceMicrocredits: BigInt(prices.unitPriceMicrocredits),
        inputTokenPriceMicrocredits: BigInt(prices.inputTokenPriceMicrocredits),
        outputTokenPriceMicrocredits: BigInt(prices.outputTokenPriceMicrocredits),
        cachedTokenPriceMicrocredits: BigInt(prices.cachedTokenPriceMicrocredits),
        priceConfigured: Boolean(input.priceConfigured),
        enabled: input.enabled === undefined || input.enabled === null ? true : Boolean(input.enabled),
      });
    }
    return result;
  }
}

interface TierSummary {
  priceConfigured: boolean;
  billingMode: string;
  unitPriceMicrocredits: number;
  inputTokenPriceMicrocredits: number;
  outputTokenPriceMicrocredits: number;
  cachedTokenPriceMicrocredits: number;
}

/** 档位摘要：通配档优先，其余取最后一档（与后台列表展示口径一致） */
function summarizeTiers(tiers: PriceTierWrite[]): TierSummary {
  const source = tiers.map((tier) => ({
    enabled: tier.enabled,
    priceConfigured: tier.priceConfigured,
    billingMode: tier.billingMode,
    unitPriceMicrocredits: toNumber(tier.unitPriceMicrocredits),
    inputTokenPriceMicrocredits: toNumber(tier.inputTokenPriceMicrocredits),
    outputTokenPriceMicrocredits: toNumber(tier.outputTokenPriceMicrocredits),
    cachedTokenPriceMicrocredits: toNumber(tier.cachedTokenPriceMicrocredits),
    resolution: tier.resolution,
    videoSeconds: tier.videoSeconds,
  }));
  return applyChannelModelPriceTierSummary<TierSummary>(
    {
      priceConfigured: false,
      billingMode: 'fixed_request',
      unitPriceMicrocredits: 0,
      inputTokenPriceMicrocredits: 0,
      outputTokenPriceMicrocredits: 0,
      cachedTokenPriceMicrocredits: 0,
    },
    source,
  );
}

/** 批量删除的 id 规范化：去空去重，1..100 */
function normalizeDeleteIds(ids: string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of ids ?? []) {
    const id = String(value ?? '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  if (result.length === 0) throw badRequest('请至少选择一个要删除的渠道模型');
  if (result.length > MAX_CHANNEL_MODEL_BATCH_DELETE) {
    throw badRequest(`单次最多删除 ${MAX_CHANNEL_MODEL_BATCH_DELETE} 个渠道模型`);
  }
  return result;
}

function decodeNameList(raw: string): string[] {
  try {
    const value = JSON.parse(raw || '[]') as unknown;
    return Array.isArray(value) ? value.map((item) => String(item ?? '')) : [];
  } catch {
    return [];
  }
}
