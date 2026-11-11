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
import type { ModelCapabilityConfig } from '../domain/capability-config';
import type { ImageParameter } from '../domain/image-parameters';
import { badRequest, normalizeModelKey, toSafeAmount, uniqueNonEmpty } from '../domain/json';
import {
  applyChannelModelPriceTierSummary,
  canonicalSkuSelector,
  normalizeChannelModelTierSelector,
  validateChannelModelTierCapabilities,
  validateChannelModelTierPricing,
  type TierSummarySource,
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
  applyDefaultModelToRequest,
  decodeDefaultModelConfig,
} from './channel-default-model';
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
  MAX_CHANNEL_MODEL_BATCH_REPRICE,
  MAX_SORT_ORDER,
  type ChannelModelPriceTierRequest,
  type ChannelModelRepriceRequest,
  type ChannelModelRequest,
  type ChannelModelSalePriceField,
  type ChannelModelListItem,
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

  /**
   * 跨渠道模型列表（后台「全部模型」视图）。
   *
   * 与 `list()`（渠道抽屉内）的三点差别：
   *   1. **带渠道名与渠道启停状态** —— 跨渠道看时不知道一行属于谁等于没看；
   *   2. `includeDisabled` 为真时**含已停用的模型与已停用的渠道** ——
   *      跨渠道视图是排查入口，看不到停用项就等于没有「重新启用」的入口；
   *   3. 不分页 —— 一次取回全部，由前端按关键词 / 能力 / 状态筛选并分页。
   *
   * `includeDisabled` 默认关闭：前台模型的线路选择器只应列出可用线路，
   * 把停用线路塞进下拉会让运营以为「选了就能用」。
   */
  async listAll(channelId?: string, includeDisabled = false): Promise<ChannelModelListItem[]> {
    const rows = await this.prisma.channelModel.findMany({
      where: {
        deletedAt: null,
        ...(includeDisabled ? {} : { enabled: true }),
        ...(channelId ? { channelId } : {}),
      },
      orderBy: [{ channelId: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    if (rows.length === 0) return [];
    const channels = await this.prisma.modelChannel.findMany({
      where: { id: { in: [...new Set(rows.map((row) => row.channelId))] } },
      select: { id: true, name: true, enabled: true },
    });
    const channelById = new Map(channels.map((row) => [row.id, row]));
    const tiers = await this.prisma.channelModelPriceTier.findMany({
      where: { channelModelId: { in: rows.map((row) => row.id) }, deletedAt: null },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map((row) => {
      const channel = channelById.get(row.channelId);
      return {
        ...channelModelView(row, tiers.filter((tier) => tier.channelModelId === row.id)),
        channelName: channel?.name ?? '',
        channelEnabled: channel?.enabled ?? false,
      };
    });
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

    /*
     * 新建商品时套用供应商默认配置。
     *
     * 只补未填字段：表单里显式改过的能力 / 协议 / 价格优先。导入路径会把
     * 完整请求直接传进来，这里再补一次是幂等的。
     */
    const isCreate = String(id ?? '').trim() === '';
    const defaults = isCreate ? decodeDefaultModelConfig(channel.defaultModelConfigJson) : null;
    const effectiveReq = defaults
      ? applyDefaultModelToRequest(req, defaults, this.protocols)
      : req;

    const contract = this.normalizeContract(channel, effectiveReq);
    const { modelKey, providerModelKey, capability, protocol, imageParameters } = contract;
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
          input: effectiveReq.capabilityConfig ?? null,
          imageParameterDefinitions: imageParameters,
        })
      : null;
    const capabilityConfigJson = capabilityConfig ? JSON.stringify(capabilityConfig) : '';

    const tiers = this.normalizePriceTiers(effectiveReq, capability, providerModelKey, capabilityConfig);
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
    if (effectiveReq.priceCurrency !== undefined && effectiveReq.priceCurrency !== null) {
      priceCurrency = normalizePriceCurrency(effectiveReq.priceCurrency);
    }

    const summary = summarizeTiers(tiers);
    const modelFields = {
      modelKey,
      activeKey: channelModelActiveKey(modelKey),
      providerModelKey,
      displayName: String(effectiveReq.displayName ?? '').trim() || '未分类',
      channelLabel,
      tags: JSON.stringify(tags),
      description,
      icon: String(effectiveReq.icon ?? '').trim(),
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
      enabled:
        effectiveReq.enabled === undefined || effectiveReq.enabled === null
          ? (existing?.enabled ?? true)
          : Boolean(effectiveReq.enabled),
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
    const next = Boolean(enabled);
    if (model.enabled === next) return;
    /*
     * 启用前必须已配置能力与协议。
     *
     * 参考实现把这条当硬约束（`app/admin_channel_model_health.go`）：没有协议的
     * 空壳模型一旦启用，就会进入路由目录成为一条必然失败的线路 ——
     * 值班时表现为「线路挂了」，而不是「配置没填完」。
     */
    if (next && (!model.capability || !model.protocol)) {
      throw badRequest('模型尚未配置能力与请求协议，请先补全后再启用');
    }
    await this.prisma.$transaction(async (tx) => {
      // 启停只改可见性，不动 priceVersion：否则一次无关的开关会让并发批量调价
      // 误报「价格已变化」。与上游 admin_channel_model_health.go 一致。
      await tx.channelModel.update({
        where: { id: model.id },
        data: { enabled: next },
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

  /**
   * 批量调价：只改售价，不动成本、能力、启停与上游模型键。
   *
   * 前端提交的是**最终售价**（由「成本 × (1 + 加价率)」四舍五入得出，也可手动
   * 改写），服务端不复算加价率。校验顺序：
   *   1. 请求形状与数量上限；
   *   2. 模型归属与价格版本（乐观并发令牌）；
   *   3. 已启用档位必须完整提交，且每个档位的版本未变；
   *   4. 只允许提交当前计费方式需要的售价字段；
   *   5. 售价合法性与计费约束。
   * 任一条不满足即整批拒绝 —— 半批成功会让「看到的价」与「扣费的价」分叉。
   */
  async repriceMany(channelId: string, requests: unknown[]): Promise<number> {
    await this.requireChannel(channelId);
    const selected = normalizeRepriceRequests(requests);
    const ids = [...selected.keys()];
    const rows = await this.prisma.channelModel.findMany({
      where: { channelId, id: { in: ids }, deletedAt: null },
    });
    if (rows.length !== ids.length) {
      throw badRequest('所选模型已删除或不属于当前渠道，请刷新后重试；本次未修改任何价格');
    }
    const tiers = await this.prisma.channelModelPriceTier.findMany({
      where: { channelModelId: { in: ids }, deletedAt: null },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

    const updates: RepriceUpdate[] = [];
    // 固定加锁顺序：并发批量请求按同一顺序更新，避免互相等待
    for (const row of [...rows].sort((a, b) => a.id.localeCompare(b.id))) {
      const request = selected.get(row.id)!;
      if (request.priceVersion !== row.priceVersion) {
        throw badRequest('模型价格已变化，请刷新后重新调价；本次未修改任何价格');
      }
      const active = tiers.filter((tier) => tier.channelModelId === row.id && tier.enabled);
      if (active.length === 0) throw badRequest(`模型 ${row.modelKey} 没有已启用的价格档，无法调价`);
      if (request.tiers.size !== active.length) {
        throw badRequest(`模型 ${row.modelKey} 的规格提交不完整或包含无效规格；本次未修改任何价格`);
      }

      const nextTiers: TierSummarySource[] = [];
      const tierUpdates: RepriceTierUpdate[] = [];
      for (const tier of active) {
        const input = request.tiers.get(tier.id);
        if (!input) {
          throw badRequest(`模型 ${row.modelKey} 的规格提交不完整或包含无效规格；本次未修改任何价格`);
        }
        if (input.priceVersion !== tier.priceVersion) {
          throw badRequest('规格价格已变化，请刷新后重新调价；本次未修改任何价格');
        }
        if (!tier.costConfigured || !tier.priceConfigured) {
          throw badRequest(`模型 ${row.modelKey}（规格 ${tier.selectorKey}）：请先保存完整的规格成本价和销售价配置`);
        }
        const fields = salePriceFields(row.capability, tier.billingMode);
        const keys = Object.keys(input.prices);
        if (keys.length !== fields.length || fields.some((field) => !(field in input.prices))) {
          throw badRequest(
            `模型 ${row.modelKey}（规格 ${tier.selectorKey}）：必须提交当前计费方式的全部销售价，且不能包含其他字段`,
          );
        }
        const prices = {
          billingMode: tier.billingMode,
          unitPriceMicrocredits: toNumber(tier.unitPriceMicrocredits),
          inputTokenPriceMicrocredits: toNumber(tier.inputTokenPriceMicrocredits),
          outputTokenPriceMicrocredits: toNumber(tier.outputTokenPriceMicrocredits),
          cachedTokenPriceMicrocredits: toNumber(tier.cachedTokenPriceMicrocredits),
        };
        const submitted: Partial<Record<ChannelModelSalePriceField, number>> = {};
        for (const field of fields) {
          submitted[field] = toSafeAmount(input.prices[field], '销售价');
          prices[field] = submitted[field];
        }
        validateChannelModelTierPricing(row.capability, tier.billingMode, prices, {
          billingMode: tier.billingMode,
          configured: tier.costConfigured,
          unitPriceMicrocredits: toNumber(tier.costUnitPriceMicrocredits),
          inputTokenPriceMicrocredits: toNumber(tier.costInputTokenPriceMicrocredits),
          outputTokenPriceMicrocredits: toNumber(tier.costOutputTokenPriceMicrocredits),
          cachedTokenPriceMicrocredits: toNumber(tier.costCachedTokenPriceMicrocredits),
        });
        tierUpdates.push({ id: tier.id, priceVersion: tier.priceVersion, prices: submitted });
        nextTiers.push({ enabled: tier.enabled, priceConfigured: tier.priceConfigured, ...prices });
      }
      updates.push({
        row,
        priceVersion: request.priceVersion,
        tierUpdates,
        summary: summarizeRepricedTiers(nextTiers),
      });
    }

    await this.prisma.$transaction(async (tx) => {
      for (const update of updates) {
        const claimed = await tx.channelModel.updateMany({
          where: { id: update.row.id, channelId, priceVersion: update.priceVersion, deletedAt: null },
          data: {
            priceVersion: { increment: 1 },
            priceConfigured: update.summary.priceConfigured,
            billingMode: update.summary.billingMode,
            unitPriceMicrocredits: BigInt(update.summary.unitPriceMicrocredits),
            inputTokenPriceMicrocredits: BigInt(update.summary.inputTokenPriceMicrocredits),
            outputTokenPriceMicrocredits: BigInt(update.summary.outputTokenPriceMicrocredits),
            cachedTokenPriceMicrocredits: BigInt(update.summary.cachedTokenPriceMicrocredits),
          },
        });
        if (claimed.count !== 1) {
          throw badRequest('模型价格已被其他操作修改，请刷新后重试；本次未修改任何价格');
        }
        for (const tier of update.tierUpdates) {
          const claimedTier = await tx.channelModelPriceTier.updateMany({
            where: {
              id: tier.id,
              channelModelId: update.row.id,
              priceVersion: tier.priceVersion,
              deletedAt: null,
            },
            data: { ...tier.prices, priceVersion: { increment: 1 } },
          });
          if (claimedTier.count !== 1) {
            throw badRequest('规格价格已被其他操作修改，请刷新后重试；本次未修改任何价格');
          }
        }
      }
    });
    await this.catalogVersion.invalidate();
    return updates.length;
  }

  /* ───────────────────────── 初始化 ───────────────────────── */

  /**
   * 渠道最早只有上游模型名清单时，按它补出停用状态的骨架行。
   *
   * 创建 / 更新渠道时传入同一个事务客户端，避免渠道已保存、模型同步失败后
   * 留下半成品。单独调用（旧数据补行）仍自开事务。
   */
  async syncInitialChannelModels(
    channel: ModelChannel,
    names: string[],
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const run = async (db: Prisma.TransactionClient | PrismaService) => {
      const existing = await db.channelModel.findMany({
        where: { channelId: channel.id, deletedAt: null },
      });
      const byKey = new Map(
        existing.map((row) => [
          row.activeKey ?? channelModelActiveKey(row.modelKey),
          row,
        ]),
      );
      const retired = retiredChannelModelKeys(channel.retiredModelsJson);
      const desired = new Set<string>();

      for (const raw of uniqueNonEmpty(names)) {
        const name = normalizeModelKey(raw);
        if (!name) continue;
        const key = channelModelActiveKey(name);
        if (retired.has(key)) continue;
        desired.add(key);
        if (byKey.has(key)) continue;
        await db.channelModel.create({
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
        await db.channelModel.update({
          where: { id: row.id },
          data: { enabled: false, priceVersion: row.priceVersion + 1 },
        });
      }
    };

    if (tx) {
      await run(tx);
      return;
    }
    await this.prisma.$transaction(run);
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
    return { modelKey, providerModelKey, capability, protocol: protocol.id, imageParameters: protocol.imageParameters };
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
    capabilityConfig: ModelCapabilityConfig | null,
  ): PriceTierWrite[] {
    // 必须用「归一化后」的合同校验价格档；直接读 req 会在调用方省略 parameters 时
    // 跳过图片参数校验，保存出与协议不匹配的选择器（对齐上游 channel_models.go）。
    const imageParameters: ImageParameter[] | undefined =
      capability === 'image' ? capabilityConfig?.image?.parameters : undefined;
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

interface RepriceTierUpdate {
  id: string;
  priceVersion: number;
  prices: Partial<Record<ChannelModelSalePriceField, number>>;
}

interface RepriceUpdate {
  row: { id: string; modelKey: string; capability: string; priceVersion: number };
  priceVersion: number;
  tierUpdates: RepriceTierUpdate[];
  summary: TierSummary;
}

/** 该计费方式下必须提交的售价字段（与参考实现一致） */
function salePriceFields(capability: string, billingMode: string): ChannelModelSalePriceField[] {
  if (billingMode !== 'token') return ['unitPriceMicrocredits'];
  if (capability === 'video') return ['outputTokenPriceMicrocredits'];
  return ['inputTokenPriceMicrocredits', 'outputTokenPriceMicrocredits', 'cachedTokenPriceMicrocredits'];
}

/** 调价后的模型级价格摘要：与保存、列表展示同一口径 */
function summarizeRepricedTiers(tiers: TierSummarySource[]): TierSummary {
  return applyChannelModelPriceTierSummary<TierSummary>(
    {
      priceConfigured: false,
      billingMode: 'fixed_request',
      unitPriceMicrocredits: 0,
      inputTokenPriceMicrocredits: 0,
      outputTokenPriceMicrocredits: 0,
      cachedTokenPriceMicrocredits: 0,
    },
    tiers,
  );
}

interface NormalizedRepriceRequest {
  priceVersion: number;
  tiers: Map<string, { priceVersion: number; prices: Record<string, unknown> }>;
}

/** 调价入参规范化：形状错误一次说清，不在循环里逐条报 */
function normalizeRepriceRequests(requests: unknown[]): Map<string, NormalizedRepriceRequest> {
  if (!Array.isArray(requests) || requests.length === 0) {
    throw badRequest('单次请选择 1 到 100 个渠道模型');
  }
  if (requests.length > MAX_CHANNEL_MODEL_BATCH_REPRICE) {
    throw badRequest(`单次最多调整 ${MAX_CHANNEL_MODEL_BATCH_REPRICE} 个渠道模型`);
  }
  const result = new Map<string, NormalizedRepriceRequest>();
  for (const raw of requests) {
    const item = (raw ?? {}) as Record<string, unknown>;
    const modelId = String(item.modelId ?? '').trim();
    const priceVersion = Number(item.priceVersion);
    if (
      !modelId ||
      result.has(modelId) ||
      !Number.isInteger(priceVersion) ||
      priceVersion < 1
    ) {
      throw badRequest('渠道模型 ID 或价格版本无效，且模型不能重复');
    }
    const tiers = new Map<string, { priceVersion: number; prices: Record<string, unknown> }>();
    const rawTiers = Array.isArray(item.priceTiers) ? item.priceTiers : [];
    for (const rawTier of rawTiers) {
      const tier = (rawTier ?? {}) as Record<string, unknown>;
      const id = String(tier.id ?? '').trim();
      const tierVersion = Number(tier.priceVersion);
      const prices = tier.prices;
      if (
        !id ||
        tiers.has(id) ||
        !Number.isInteger(tierVersion) ||
        tierVersion < 1 ||
        !prices ||
        typeof prices !== 'object' ||
        Array.isArray(prices)
      ) {
        throw badRequest('规格 ID 不能为空或重复，销售价格式需为对象');
      }
      tiers.set(id, { priceVersion: tierVersion, prices: prices as Record<string, unknown> });
    }
    result.set(modelId, { priceVersion, tiers });
  }
  return result;
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
