/**
 * 前台模型（LogicalModel）后台管理：列表投影、保存（新 revision + 线路重建）、归档。
 *
 * 移植自 open-ai-canvas `internal/app/logical_models.go` 的管理端部分。三条实现约束：
 *
 *   1. **revision 不可变**：每次保存都新建 revision 并原子递增 `revisionSequence`，
 *      旧 revision 与旧线路保留 —— 历史任务的账单要能回溯到当时的能力合同；
 *   2. **保存顺序即校验顺序**：code/name → 能力类型 → 能力合同 → 默认参数 →
 *      价格策略 → 线路（能力一致、权重、渠道存在）→ 覆盖校验 → `channel` 策略
 *      结算可用性 → 落库；顺序被打乱时后置错误会掩盖前置冲突；
 *   3. **写入即失效目录版本**：`CatalogVersionService.invalidate()` 让本进程与其他
 *      进程的目录快照在下一个请求前重载，不能等 TTL。
 *
 * 本仓与参考实现的一处**刻意差异**：`LogicalModel.capability` 存 C 端能力 id
 * （`free_create` 等），能力合同 `capabilitySpec.capability` 存产出模态（`image`）。
 * 准入按能力 id 选模型（`task-admission.service`），因此保存时用能力插件的
 * `model.capability` 校验合同模态，而不是拿两者直接比较。
 */

import { Injectable, Logger } from '@nestjs/common';
import type { LogicalModel, LogicalModelRevision } from '@prisma/client';
import { AppError } from '../../common/app.exception';
import { PrismaService } from '../../prisma/prisma.service';
import { getCapability } from '../../capabilities/capability.registry';
import { decodeCapabilityConfig, normalizeCapability } from '../domain/capability-config';
import { badRequest, decodeJson, toSafeAmount, uniqueNonEmpty } from '../domain/json';
import { decodeSkuSelector, supportsTokenBilling } from '../domain/selector';
import { toNumber } from '../channels/channel.presentation';
import { CatalogVersionService } from '../infra/catalog-version.service';
import {
  capabilitySpecFromModelCapabilityConfig,
  capabilitySpecWithPriceTiers,
  capabilitySpecWithRoutePresets,
  decodeCapabilitySpec,
  effectiveImageParameterSpec,
  logicalModelCapabilityCovered,
  normalizeCapabilitySpec,
  normalizeLogicalDefaults,
  validateProductSpecWithinRoutes,
} from '../intent/capability-spec';
import type { CapabilitySpec } from '../intent/spec-types';
import {
  computeModelPriceDisplay,
  type PublicLogicalModel,
  type PublicLogicalModelPriceTier,
} from './catalog.service';
import type { CachedLogicalModel } from '../routing/routing.types';

const LOGICAL_MODEL_CODE_PATTERN = /^[a-z0-9][a-z0-9._-]{1,79}$/;
const MAX_SORT_ORDER = 999_999;
const PRICE_POLICIES = ['unified', 'channel'] as const;
const BILLING_MODES = ['fixed_request', 'per_second', 'token'] as const;

/** 保存入参：字段缺省即按默认值处理（PATCH 语义 = 全量提交，与参考实现一致） */
export interface LogicalRouteRequest {
  channelModelId?: string;
  enabled?: boolean;
  priority?: number;
  weight?: number;
}

export interface LogicalModelRequest {
  code?: string;
  name?: string;
  icon?: string;
  description?: string;
  /** C 端能力 id（`free_create` 等）；必填 */
  capability?: string;
  enabled?: boolean;
  sortOrder?: number;
  pricePolicy?: string;
  billingMode?: string;
  unitPriceMicrocredits?: number | string;
  inputPriceMicrocredits?: number | string;
  outputPriceMicrocredits?: number | string;
  cachedPriceMicrocredits?: number | string;
  legacyModelIds?: string[] | null;
  capabilitySpec?: unknown;
  defaultOptions?: Record<string, unknown> | null;
  routes?: LogicalRouteRequest[];
  /** 仅系统渠道同步流程使用（本仓当前无同步入口，保留字段） */
  sourceChannelModelId?: string;
}

/** 后台线路投影：管理员要看到「这条线为什么不可用」 */
export interface AdminLogicalRoute {
  id: string;
  channelModelId: string;
  channelId: string;
  channelName: string;
  channelModelKey: string;
  channelModelName: string;
  enabled: boolean;
  priority: number;
  weight: number;
  /** 结构可用（线路启用 + 权重 > 0 + 渠道模型启用 + 渠道启用） */
  structurallyAvailable: boolean;
  /** 结算可用（结构可用 + 计费方式可承接 + `channel` 策略下已配置价格档） */
  available: boolean;
  capabilitySpec: CapabilitySpec;
}

export interface AdminLogicalModel extends PublicLogicalModel {
  enabled: boolean;
  activeRevisionId: string;
  revisionVersion: number;
  configurationError: string;
  availabilityError: string;
  archivedAt: string | null;
  routes: AdminLogicalRoute[];
}

/** 保存前的完整校验结果（事务外算好，事务内只写） */
interface LogicalModelBundle {
  creating: boolean;
  existingId: string | null;
  data: {
    code: string;
    name: string;
    icon: string;
    description: string;
    capability: string;
    enabled: boolean;
    sortOrder: number;
    sourceChannelModelId: string;
    pricePolicy: string;
    billingMode: string;
    unitPriceMicrocredits: number;
    inputPriceMicrocredits: number;
    outputPriceMicrocredits: number;
    cachedPriceMicrocredits: number;
    legacyModelIdsJson: string;
  };
  capabilitySpec: CapabilitySpec;
  defaults: Record<string, unknown>;
  routes: Array<{ channelModelId: string; enabled: boolean; priority: number; weight: number }>;
}

/** 一条线路的校验结果 */
interface CheckedRoute {
  channelModelId: string;
  channelId: string;
  channelName: string;
  channelModelKey: string;
  channelModelName: string;
  enabled: boolean;
  priority: number;
  weight: number;
  structurallyAvailable: boolean;
  priceConfigured: boolean;
  capabilitySpec: CapabilitySpec;
}

@Injectable()
export class LogicalModelAdminService {
  private readonly log = new Logger(LogicalModelAdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly catalogVersion: CatalogVersionService,
  ) {}

  /* ───────────────────────── 查询 ───────────────────────── */

  /** 后台列表；默认不含归档（归档后仍可凭 id 读取，供历史任务排查） */
  async list(includeArchived = false): Promise<AdminLogicalModel[]> {
    const rows = await this.prisma.logicalModel.findMany({
      where: includeArchived ? {} : { archivedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    return this.buildViews(rows);
  }

  async get(id: string): Promise<AdminLogicalModel> {
    const row = await this.requireModel(id);
    const [view] = await this.buildViews([row]);
    if (!view) throw notFound();
    return view;
  }

  /* ───────────────────────── 保存 ───────────────────────── */

  /**
   * 创建 / 更新前台模型。返回保存后的后台投影（含逐线路判定），
   * 调用方不需要再发一次列表请求。
   */
  async save(id: string, req: LogicalModelRequest, actorId = ''): Promise<AdminLogicalModel> {
    const bundle = await this.buildBundle(id, req);
    const savedId = await this.prisma.$transaction(async (tx) => {
      let logicalModelId = bundle.existingId;
      const shared = {
        code: bundle.data.code,
        activeKey: bundle.data.code,
        name: bundle.data.name,
        icon: bundle.data.icon,
        description: bundle.data.description,
        capability: bundle.data.capability,
        enabled: bundle.data.enabled,
        sortOrder: bundle.data.sortOrder,
        sourceChannelModelId: bundle.data.sourceChannelModelId,
        pricePolicy: bundle.data.pricePolicy,
        billingMode: bundle.data.billingMode,
        unitPriceMicrocredits: BigInt(bundle.data.unitPriceMicrocredits),
        inputPriceMicrocredits: BigInt(bundle.data.inputPriceMicrocredits),
        outputPriceMicrocredits: BigInt(bundle.data.outputPriceMicrocredits),
        cachedPriceMicrocredits: BigInt(bundle.data.cachedPriceMicrocredits),
        legacyModelIdsJson: bundle.data.legacyModelIdsJson,
      };
      if (!logicalModelId) {
        /*
         * 一个渠道模型最多投影出一个未归档前台模型。
         *
         * 参考实现用部分唯一索引保证（`source_channel_model_id` 非空且未归档）。
         * SQLite / Prisma 不支持部分唯一索引，这里在事务内做应用层等价校验 ——
         * 不校验会让同一渠道模型被两条前台线路重复计入，成本与可用性都算错。
         */
        if (bundle.data.sourceChannelModelId) {
          const duplicated = await tx.logicalModel.count({
            where: {
              sourceChannelModelId: bundle.data.sourceChannelModelId,
              archivedAt: null,
            },
          });
          if (duplicated > 0) {
            throw badRequest('该渠道模型已投影出前台模型，请直接编辑既有前台模型');
          }
        }
        // 首个 revision 版本从 1 开始；更新路径走 increment，两条路径的版本单调递增
        const created = await tx.logicalModel.create({ data: { ...shared, revisionSequence: 1 } });
        logicalModelId = created.id;
      } else {
        // revisionSequence 必须原子递增：并发保存拿到同一版本号会让唯一约束兜底失败
        await tx.logicalModel.update({
          where: { id: logicalModelId },
          data: { ...shared, revisionSequence: { increment: 1 } },
        });
      }
      const current = await tx.logicalModel.findUniqueOrThrow({ where: { id: logicalModelId } });
      const revision = await tx.logicalModelRevision.create({
        data: {
          logicalModelId,
          version: current.revisionSequence,
          capabilitySpecJson: JSON.stringify(bundle.capabilitySpec),
          defaultOptionsJson: JSON.stringify(bundle.defaults),
          createdBy: actorId,
        },
      });
      if (bundle.routes.length > 0) {
        await tx.logicalModelRoute.createMany({
          data: bundle.routes.map((route) => ({
            logicalModelRevisionId: revision.id,
            channelModelId: route.channelModelId,
            enabled: route.enabled,
            priority: route.priority,
            weight: route.weight,
          })),
        });
      }
      await tx.logicalModel.update({
        where: { id: logicalModelId },
        data: { activeRevisionId: revision.id },
      });
      return logicalModelId;
    });
    this.catalogVersion.invalidate();
    return this.get(savedId);
  }

  /* ───────────────────────── 归档 ───────────────────────── */

  /**
   * 归档（软删除）：从可选目录隐藏，历史任务仍可读。
   *
   * 仍被排队中 / 进行中任务引用时拒绝 —— 归档后重试只能回到原 revision，
   * 而原线路可能已随 revision 一起消失；让管理员等任务结束是最小惊讶的做法。
   */
  async archive(id: string): Promise<void> {
    const model = await this.requireModel(id);
    if (model.archivedAt) throw notFound();
    if (model.sourceChannelModelId) {
      throw badRequest('该前台模型由系统渠道自动同步，请在系统渠道模型中停用');
    }
    const busy = await this.prisma.generationTask.count({
      where: { logicalModelId: model.id, status: { in: ['queued', 'running'] } },
    });
    if (busy > 0) {
      throw badRequest('前台模型仍被排队中或进行中任务使用，请等待任务结束后再归档');
    }
    await this.prisma.logicalModel.update({
      where: { id: model.id },
      // activeKey 置 null 才能让同一 code 重新创建（唯一约束按 activeKey 生效）
      data: { archivedAt: new Date(), enabled: false, activeKey: null },
    });
    this.catalogVersion.invalidate();
  }

  /* ───────────────────────── 校验 ───────────────────────── */

  private async buildBundle(id: string, req: LogicalModelRequest): Promise<LogicalModelBundle> {
    const code = String(req.code ?? '').trim().toLowerCase();
    const name = String(req.name ?? '').trim();
    const capability = String(req.capability ?? '').trim();
    if (!LOGICAL_MODEL_CODE_PATTERN.test(code)) {
      throw badRequest('模型 code 需为 2-80 位小写字母、数字、点、下划线或连字符');
    }
    if (name === '' || [...name].length > 120) throw badRequest('请填写 1-120 个字符的模型名称');
    const definition = getCapability(capability);
    if (!definition) throw badRequest(`不支持的能力: ${capability}`);

    const productSpec = this.normalizeSpec(req.capabilitySpec);
    if (normalizeCapability(productSpec.capability) !== normalizeCapability(definition.model.capability)) {
      throw badRequest(`能力 ${capability} 属于 ${definition.model.capability} 模态，前台模型能力配置必须是同一模态`);
    }
    const defaults = normalizeLogicalDefaults(productSpec, (req.defaultOptions ?? {}) as Record<string, unknown>);

    const sortOrder = Math.trunc(Number(req.sortOrder ?? 0));
    if (!Number.isFinite(sortOrder) || sortOrder < 0 || sortOrder > MAX_SORT_ORDER) {
      throw badRequest(`排序值必须在 0-${MAX_SORT_ORDER} 之间`);
    }
    const pricePolicy = String(req.pricePolicy ?? '').trim();
    if (!(PRICE_POLICIES as readonly string[]).includes(pricePolicy)) {
      throw badRequest('请选择跟随供应价格或统一定价');
    }
    let billingMode = String(req.billingMode ?? 'fixed_request').trim() || 'fixed_request';
    let unitPrice = toSafeAmount(req.unitPriceMicrocredits, '单次价格');
    let inputPrice = toSafeAmount(req.inputPriceMicrocredits, '输入 Token 价格');
    let outputPrice = toSafeAmount(req.outputPriceMicrocredits, '输出 Token 价格');
    let cachedPrice = toSafeAmount(req.cachedPriceMicrocredits, '缓存 Token 价格');
    if (pricePolicy === 'channel') {
      // 渠道策略下价格真相在渠道模型的价格档，前台标量价只读
      billingMode = 'fixed_request';
      unitPrice = 0;
      inputPrice = 0;
      outputPrice = 0;
      cachedPrice = 0;
    } else {
      if (!(BILLING_MODES as readonly string[]).includes(billingMode)) {
        throw badRequest('前台模型计费方式仅支持按次、按秒或 Token');
      }
      const modality = normalizeCapability(productSpec.capability);
      if (billingMode === 'per_second' && modality !== 'video' && modality !== 'audio') {
        throw badRequest('只有视频或音频前台模型可以按秒计费');
      }
      if (billingMode === 'token') {
        if (!supportsTokenBilling(modality)) throw badRequest('Token 计费仅支持文本和视频前台模型');
        if (outputPrice <= 0 && inputPrice <= 0 && cachedPrice <= 0) {
          throw badRequest('Token 计费模型必须至少配置一项 Token 价格');
        }
      }
    }

    const creating = String(id ?? '').trim() === '';
    const existing = creating ? null : await this.requireModel(id);
    const conflict = await this.prisma.logicalModel.findFirst({
      where: { activeKey: code, ...(existing ? { id: { not: existing.id } } : {}) },
      select: { id: true },
    });
    if (conflict) throw badRequest(`模型 code ${code} 已被占用`);

    const enabled = Boolean(req.enabled);
    const routeInputs = Array.isArray(req.routes) ? req.routes : [];
    const checked = await this.checkRoutes(routeInputs, productSpec, enabled);
    const structuralSpecs = checked
      .filter((route) => route.structurallyAvailable)
      .map((route) => route.capabilitySpec);
    const settlementSpecs = checked
      .filter((route) => routeIsSettleable(route, pricePolicy))
      .map((route) => route.capabilitySpec);

    // 图片能力合同的展示维度（预设 / 标注）只能来自真实线路，前端不能凭空发明
    let finalSpec = productSpec;
    let finalDefaults = defaults;
    if (normalizeCapability(productSpec.capability) === 'image' && structuralSpecs.length > 0) {
      finalSpec = effectiveImageParameterSpec(productSpec, structuralSpecs);
      if (finalSpec.imageParameters !== undefined) {
        validateProductSpecWithinRoutes(finalSpec, structuralSpecs);
        finalDefaults = normalizeLogicalDefaults(finalSpec, defaults);
      }
    }

    // 停用必须始终可执行：管理员要能立即阻止失效线路继续对外服务
    if (enabled) {
      if (structuralSpecs.length === 0) {
        throw badRequest('启用前台模型前至少需要一条已启用的供应线路');
      }
      validateProductSpecWithinRoutes(finalSpec, structuralSpecs);
      const availabilityError = availabilityErrorOf(pricePolicy, finalSpec, structuralSpecs, settlementSpecs);
      if (availabilityError) throw badRequest(availabilityError);
    }

    return {
      creating,
      existingId: existing?.id ?? null,
      data: {
        code,
        name,
        icon: String(req.icon ?? '').trim(),
        description: String(req.description ?? '').trim(),
        capability,
        enabled,
        sortOrder,
        sourceChannelModelId: String(req.sourceChannelModelId ?? '').trim() || existing?.sourceChannelModelId || '',
        pricePolicy,
        billingMode,
        unitPriceMicrocredits: unitPrice,
        inputPriceMicrocredits: inputPrice,
        outputPriceMicrocredits: outputPrice,
        cachedPriceMicrocredits: cachedPrice,
        legacyModelIdsJson:
          req.legacyModelIds === undefined || req.legacyModelIds === null
            ? existing
              ? JSON.stringify(decodeStringArray(existing.legacyModelIdsJson))
              : '[]'
            : JSON.stringify(uniqueNonEmpty(req.legacyModelIds)),
      },
      capabilitySpec: finalSpec,
      defaults: finalDefaults,
      routes: checked.map((route) => ({
        channelModelId: route.channelModelId,
        enabled: route.enabled,
        priority: route.priority,
        weight: route.weight,
      })),
    };
  }

  private normalizeSpec(raw: unknown): CapabilitySpec {
    if (!raw || typeof raw !== 'object') throw badRequest('请填写前台模型能力配置');
    return normalizeCapabilitySpec(raw as CapabilitySpec);
  }

  /** 线路校验：存在、系统渠道、能力一致、权重合法；同时算出结构 / 计费可用性 */
  private async checkRoutes(
    inputs: LogicalRouteRequest[],
    productSpec: CapabilitySpec,
    modelEnabled: boolean,
  ): Promise<CheckedRoute[]> {
    if (inputs.length === 0) return [];
    const channelModelIds = uniqueNonEmpty(inputs.map((route) => route.channelModelId));
    if (channelModelIds.length !== inputs.length) {
      throw badRequest('供应线路必须选择不重复的渠道模型');
    }
    const channelModels = await this.prisma.channelModel.findMany({
      where: { id: { in: channelModelIds }, deletedAt: null },
    });
    const channelModelById = new Map(channelModels.map((row) => [row.id, row]));
    const channels = await this.prisma.modelChannel.findMany({
      where: { id: { in: [...new Set(channelModels.map((row) => row.channelId))] }, deletedAt: null },
      select: { id: true, name: true, scope: true, enabled: true },
    });
    const channelById = new Map(channels.map((row) => [row.id, row]));
    const tiers = await this.prisma.channelModelPriceTier.findMany({
      where: { channelModelId: { in: channelModelIds }, deletedAt: null },
    });

    const result: CheckedRoute[] = [];
    for (const input of inputs) {
      const channelModelId = String(input.channelModelId ?? '').trim();
      const channelModel = channelModelById.get(channelModelId);
      if (!channelModel) throw badRequest('供应线路引用的渠道模型不存在');
      const channel = channelById.get(channelModel.channelId);
      if (!channel || channel.scope !== 'system') throw badRequest('供应线路只能选择系统渠道模型');

      const capabilitySpec = capabilitySpecWithPriceTiers(
        capabilitySpecFromModelCapabilityConfig(
          decodeCapabilityConfig(channelModel.capabilityConfigJson),
          channelModel.capability,
          channelModel.protocol,
        ),
        tiers.filter((tier) => tier.channelModelId === channelModel.id),
        channelModel.protocol,
      );
      if (normalizeCapability(capabilitySpec.capability) !== normalizeCapability(productSpec.capability)) {
        throw badRequest('供应线路能力类型与前台模型不一致');
      }
      const enabled = Boolean(input.enabled);
      const priority = Math.trunc(Number(input.priority ?? 0));
      const weight = Math.trunc(Number(input.weight ?? 100));
      if (!Number.isFinite(priority)) throw badRequest('供应线路优先级必须是整数');
      if (!Number.isFinite(weight) || weight < 0) throw badRequest('供应线路的同级权重不能为负数');
      if (modelEnabled && enabled && weight <= 0) {
        throw badRequest('启用供应线路的同级权重必须大于 0');
      }

      result.push({
        channelModelId,
        channelId: channelModel.channelId,
        channelName: channel.name,
        channelModelKey: channelModel.modelKey,
        channelModelName: channelModel.displayName || channelModel.modelKey,
        enabled,
        priority,
        weight,
        structurallyAvailable: enabled && weight > 0 && channelModel.enabled && channel.enabled,
        // 计费方式可承接性在 `save` 前段已校验（token 只允许 text/video），这里不必重复
        priceConfigured: channelModel.priceConfigured,
        capabilitySpec,
      });
    }
    return result;
  }

  /* ───────────────────────── 投影 ───────────────────────── */

  private async buildViews(rows: LogicalModel[]): Promise<AdminLogicalModel[]> {
    if (rows.length === 0) return [];
    const revisionIds = rows.map((row) => row.activeRevisionId).filter((value) => value !== '');
    const revisions = revisionIds.length
      ? await this.prisma.logicalModelRevision.findMany({ where: { id: { in: revisionIds } } })
      : [];
    const revisionById = new Map(revisions.map((row) => [row.id, row]));
    const routeRows = revisions.length
      ? await this.prisma.logicalModelRoute.findMany({
          where: { logicalModelRevisionId: { in: revisions.map((row) => row.id) } },
          orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
        })
      : [];
    const channelModelIds = [...new Set(routeRows.map((row) => row.channelModelId))];
    const channelModels = channelModelIds.length
      ? await this.prisma.channelModel.findMany({ where: { id: { in: channelModelIds }, deletedAt: null } })
      : [];
    const channelModelById = new Map(channelModels.map((row) => [row.id, row]));
    const channelIds = [...new Set(channelModels.map((row) => row.channelId))];
    const channels = channelIds.length
      ? await this.prisma.modelChannel.findMany({ where: { id: { in: channelIds }, deletedAt: null } })
      : [];
    const channelById = new Map(channels.map((row) => [row.id, row]));
    const tiers = channelModelIds.length
      ? await this.prisma.channelModelPriceTier.findMany({
          where: { channelModelId: { in: channelModelIds }, deletedAt: null },
          orderBy: [{ createdAt: 'asc' }],
        })
      : [];

    const result: AdminLogicalModel[] = [];
    for (const row of rows) {
      const view = this.assembleView(row, revisionById.get(row.activeRevisionId) ?? null, routeRows, {
        channelModelById,
        channelById,
        tiers,
      });
      if (view) result.push(view);
    }
    return result;
  }

  private assembleView(
    row: LogicalModel,
    revision: LogicalModelRevision | null,
    routeRows: Array<{
      id: string;
      logicalModelRevisionId: string;
      channelModelId: string;
      enabled: boolean;
      priority: number;
      weight: number;
    }>,
    ctx: {
      channelModelById: Map<
        string,
        {
          id: string;
          channelId: string;
          modelKey: string;
          displayName: string;
          enabled: boolean;
          capability: string;
          protocol: string;
          capabilityConfigJson: string;
          priceConfigured: boolean;
        }
      >;
      channelById: Map<string, { id: string; name: string; scope: string; enabled: boolean }>;
      tiers: Array<{
        id: string;
        channelModelId: string;
        selectorJson: string;
        resolution: string;
        videoSeconds: number;
        billingMode: string;
        unitPriceMicrocredits: bigint;
        inputTokenPriceMicrocredits: bigint;
        outputTokenPriceMicrocredits: bigint;
        cachedTokenPriceMicrocredits: bigint;
        enabled: boolean;
        priceConfigured: boolean;
      }>;
    },
  ): AdminLogicalModel | null {
    if (!revision) {
      this.log.warn(`前台模型 ${row.id} 没有活动 revision，后台列表跳过`);
      return null;
    }
    let productSpec: CapabilitySpec;
    try {
      productSpec = decodeCapabilitySpec(revision.capabilitySpecJson);
    } catch (error) {
      this.log.warn(`前台模型 ${row.id} 能力合同非法：${describe(error)}`);
      return null;
    }

    const routes: AdminLogicalRoute[] = [];
    const structuralSpecs: CapabilitySpec[] = [];
    const settlementSpecs: CapabilitySpec[] = [];
    let missingRoute = false;
    for (const route of routeRows) {
      if (route.logicalModelRevisionId !== revision.id) continue;
      const channelModel = ctx.channelModelById.get(route.channelModelId);
      const channel = channelModel ? ctx.channelById.get(channelModel.channelId) : undefined;
      if (!channelModel || !channel) {
        missingRoute = true;
        continue;
      }
      let capabilitySpec: CapabilitySpec;
      try {
        capabilitySpec = capabilitySpecWithPriceTiers(
          capabilitySpecFromModelCapabilityConfig(
            decodeCapabilityConfig(channelModel.capabilityConfigJson),
            channelModel.capability,
            channelModel.protocol,
          ),
          ctx.tiers.filter((tier) => tier.channelModelId === channelModel.id),
          channelModel.protocol,
        );
      } catch (error) {
        this.log.warn(`线路 ${route.id} 能力配置非法：${describe(error)}`);
        continue;
      }
      const structurallyAvailable =
        route.enabled && route.weight > 0 && channelModel.enabled && channel.enabled;
      const billingAvailable =
        row.pricePolicy !== 'unified' ||
        row.billingMode !== 'token' ||
        supportsTokenBilling(normalizeCapability(capabilitySpec.capability));
      const available =
        structurallyAvailable &&
        billingAvailable &&
        (row.pricePolicy !== 'channel' || channelModel.priceConfigured);
      if (structurallyAvailable) structuralSpecs.push(capabilitySpec);
      if (available) settlementSpecs.push(capabilitySpec);
      routes.push({
        id: route.id,
        channelModelId: channelModel.id,
        channelId: channelModel.channelId,
        channelName: channel.name,
        channelModelKey: channelModel.modelKey,
        channelModelName: channelModel.displayName || channelModel.modelKey,
        enabled: route.enabled,
        priority: route.priority,
        weight: route.weight,
        structurallyAvailable,
        available,
        capabilitySpec,
      });
    }

    const mergedSpec = capabilitySpecWithRoutePresets(productSpec, structuralSpecs);
    let defaults: Record<string, unknown> = {};
    try {
      defaults = normalizeLogicalDefaults(
        mergedSpec,
        decodeJson<Record<string, unknown>>(revision.defaultOptionsJson, {}, '前台模型默认参数'),
      );
    } catch (error) {
      this.log.warn(`前台模型 ${row.id} 默认参数非法：${describe(error)}`);
    }
    const configurationError = missingRoute
      ? '供应线路引用的渠道模型或渠道已删除，请调整线路'
      : !logicalModelCapabilityCovered(mergedSpec, structuralSpecs)
        ? '供应线路已无法完整覆盖创作端能力，请调整线路或能力范围'
        : '';
    const availabilityError = availabilityErrorOf(row.pricePolicy, mergedSpec, structuralSpecs, settlementSpecs);

    const cached: CachedLogicalModel = {
      id: row.id,
      code: row.code,
      name: row.name,
      icon: row.icon,
      description: row.description,
      capability: row.capability,
      sortOrder: row.sortOrder,
      enabled: row.enabled,
      pricePolicy: row.pricePolicy,
      billingMode: row.billingMode,
      unitPriceMicrocredits: toNumber(row.unitPriceMicrocredits),
      inputPriceMicrocredits: toNumber(row.inputPriceMicrocredits),
      outputPriceMicrocredits: toNumber(row.outputPriceMicrocredits),
      cachedPriceMicrocredits: toNumber(row.cachedPriceMicrocredits),
      legacyModelIds: decodeStringArray(row.legacyModelIdsJson),
      revisionId: revision.id,
      revisionVersion: revision.version,
      productSpec: mergedSpec,
      defaults,
      routes: [],
      archivedAt: row.archivedAt ? row.archivedAt.getTime() : null,
    };
    const priceTiers = adminPriceTiers(row, routes, ctx.tiers);
    const { pricingMode, displayPrice, priceLabel } = computeModelPriceDisplay(cached, priceTiers);
    const available =
      settlementSpecs.length > 0 && configurationError === '' && availabilityError === '';

    return {
      id: row.id,
      code: row.code,
      name: row.name,
      icon: row.icon,
      description: row.description,
      capability: row.capability,
      sortOrder: row.sortOrder,
      pricePolicy: row.pricePolicy,
      pricingMode,
      displayPrice,
      priceLabel,
      billingMode: row.billingMode,
      unitPriceMicrocredits: cached.unitPriceMicrocredits,
      inputPriceMicrocredits: cached.inputPriceMicrocredits,
      outputPriceMicrocredits: cached.outputPriceMicrocredits,
      cachedPriceMicrocredits: cached.cachedPriceMicrocredits,
      priceTiers,
      legacyModelIds: cached.legacyModelIds,
      capabilitySpec: mergedSpec,
      capabilityProfiles: dedupeSpecs(structuralSpecs),
      defaultOptions: defaults,
      available,
      enabled: row.enabled,
      activeRevisionId: revision.id,
      revisionVersion: revision.version,
      configurationError,
      availabilityError,
      archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
      routes,
    };
  }

  private async requireModel(id: string): Promise<LogicalModel> {
    const key = String(id ?? '').trim();
    const row = key ? await this.prisma.logicalModel.findUnique({ where: { id: key } }) : null;
    if (!row) throw notFound();
    return row;
  }
}

/* ────────────────────────── 纯函数 ────────────────────────── */

function notFound(): AppError {
  return new AppError(40400, '前台模型不存在或已删除', 404);
}

/** 线路是否可结算：结构可用 + 计费可承接 + `channel` 策略必须有启用且已定价的档 */
function routeIsSettleable(route: CheckedRoute, pricePolicy: string): boolean {
  return route.structurallyAvailable && (pricePolicy !== 'channel' || route.priceConfigured);
}

function availabilityErrorOf(
  pricePolicy: string,
  productSpec: CapabilitySpec,
  structuralSpecs: CapabilitySpec[],
  settlementSpecs: CapabilitySpec[],
): string {
  if (pricePolicy !== 'channel' || structuralSpecs.length === 0) return '';
  if (settlementSpecs.length === 0) return '供应线路尚未配置可结算价格，请先完善渠道模型价格';
  if (!logicalModelCapabilityCovered(productSpec, settlementSpecs)) {
    return '部分创作端能力只能由未配置价格的渠道模型承接，请完善对应价格';
  }
  return '';
}

function adminPriceTiers(
  row: LogicalModel,
  routes: AdminLogicalRoute[],
  tiers: Array<{
    channelModelId: string;
    selectorJson: string;
    resolution: string;
    videoSeconds: number;
    billingMode: string;
    unitPriceMicrocredits: bigint;
    inputTokenPriceMicrocredits: bigint;
    outputTokenPriceMicrocredits: bigint;
    cachedTokenPriceMicrocredits: bigint;
    enabled: boolean;
    priceConfigured: boolean;
  }>,
): PublicLogicalModelPriceTier[] {
  if (row.pricePolicy !== 'channel') return [];
  const result: PublicLogicalModelPriceTier[] = [];
  const seen = new Set<string>();
  for (const route of routes) {
    if (!route.enabled || route.weight <= 0) continue;
    for (const tier of tiers) {
      if (tier.channelModelId !== route.channelModelId) continue;
      if (!tier.enabled || !tier.priceConfigured) continue;
      const selector = decodeSkuSelector(tier.selectorJson);
      const key = JSON.stringify(selector);
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({
        selector,
        resolution: tier.resolution,
        videoSeconds: tier.videoSeconds,
        billingMode: tier.billingMode,
        unitPriceMicrocredits: toNumber(tier.unitPriceMicrocredits),
        inputTokenPriceMicrocredits: toNumber(tier.inputTokenPriceMicrocredits),
        outputTokenPriceMicrocredits: toNumber(tier.outputTokenPriceMicrocredits),
        cachedTokenPriceMicrocredits: toNumber(tier.cachedTokenPriceMicrocredits),
      });
    }
  }
  return result;
}

function dedupeSpecs(specs: CapabilitySpec[]): CapabilitySpec[] {
  const result: CapabilitySpec[] = [];
  const seen = new Set<string>();
  for (const spec of specs) {
    const key = JSON.stringify(spec);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(spec);
  }
  return result;
}

function decodeStringArray(raw: string | null | undefined): string[] {
  return uniqueNonEmpty(decodeJson<unknown[]>(raw, [], '旧模型映射'));
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
