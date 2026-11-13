/**
 * 任务准入 —— 一次生成请求在进入队列之前必须通过的关卡。
 *
 * 移植自 open-ai-canvas `internal/app/task_creation.go` 的 `CreateTask`：
 * 校验顺序即文档顺序，**任何一条在扣费之前失败都不能留下账单**。
 *
 * 不可调换的顺序
 * --------------
 *   1. 幂等命中先于一切校验：重试请求要拿回原任务，不能因为原任务仍占着
 *      并发额度或参数已随模型下线而被拒之门外；
 *   2. 素材归属 / 遮罩 / 标注校验先于计价：遮罩不属于本人却先扣了积分，
 *      用户会为一次注定失败的任务付费；
 *   3. 模型解析先于计价：价格档挂在具体线路上，没选出线路就没有价；
 *   4. 计价之后，**建任务 + 建单 + 预留在一个事务里完成**：分两步会留下
 *      「排队中但永远不动」的任务（worker 有兜底，但那只是补偿，不是设计）。
 *
 * 失败语义
 * --------
 *   · 模型不存在 / 已归档 / 无可用线路 → `40005`（前端提示「换个模型」，而不是「参数错了」）；
 *   · 遮罩线路不支持 → `42205`；
 *   · 余额不足 → `40201`（Payment Required，前端展示「去充值」）。
 */

import { createHash, randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  getCapability,
  sanitizeParams,
  validateCapabilityParams,
} from '../../capabilities/capability.registry';
import { CapabilityAvailabilityService } from '../../capabilities/capability-availability.service';
import {
  normalizeLocalRedrawBounds,
  parseLocalRedrawAnnotations,
} from '../../capabilities/definitions/local_redraw';
import { AppError } from '../../common/app.exception';
import { CreditPriceService } from '../../credits/credit-price.service';
import { CreateGenerationDto } from '../../generate/dto/create-generation.dto';
import { MembershipService } from '../../membership/membership.service';
import { PrismaService } from '../../prisma/prisma.service';
import { PromptToolsService } from '../../prompt-tools/prompt-tools.service';
import { type BillingDraft, BillingService } from '../billing/billing.service';
import { restrictIntentToSpec } from '../intent/model-intent';
import { RouterService } from '../routing/router.service';
import { UserGroupService } from '../user-groups/user-group.service';
import { scaleMultiFusionDraft } from './task-billing-scale';

/** 一次准入的输入 */
export interface AdmissionInput {
  ownerId: string;
  dto: CreateGenerationDto;
  idempotencyHeader?: string;
}

/** 准入结果：与既有建任务接口的返回保持一致 */
export interface AdmissionResult {
  taskId: string;
  status: string;
  /** 本次合计消耗（多图产出按张计费，这里已是 N 张之和） */
  creditCost: number;
  idempotentHit: boolean;
  /** 多图产出批次 id（一次生成拆成 N 个任务时才有） */
  batchId?: string;
  /** 本批次的图片张数；单图能力与旧任务缺省 */
  batchSize?: number;
}

const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9._:-]{8,128}$/;
/** 单次提交的输入图上限（与前端上传组件一致） */
const MAX_INPUT_ASSETS = 10;

@Injectable()
export class TaskAdmissionService {
  private readonly log = new Logger(TaskAdmissionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly membership: MembershipService,
    private readonly availability: CapabilityAvailabilityService,
    private readonly price: CreditPriceService,
    private readonly billing: BillingService,
    private readonly router: RouterService,
    private readonly groups: UserGroupService,
    private readonly promptTools: PromptToolsService,
  ) {}

  async admit(input: AdmissionInput): Promise<AdmissionResult> {
    const { ownerId, dto } = input;
    const idempotencyKey = normalizeIdempotencyKey(dto.idempotencyKey, input.idempotencyHeader);
    const requestFingerprint = idempotencyKey ? generationRequestFingerprint(dto) : undefined;

    // 1. 幂等命中：直接返回原任务，不再校验任何会随状态变化的约束
    if (idempotencyKey) {
      const existing = await this.prisma.generationTask.findUnique({
        where: { ownerId_idempotencyKey: { ownerId, idempotencyKey } },
      });
      if (existing) return toIdempotentResult(existing, requestFingerprint!);
    }

    // 2. 能力与参数白名单
    const def = getCapability(dto.capability);
    if (!def) throw new AppError(40001, `不支持的能力: ${dto.capability}`, 400);
    if (def.mode === 'planned') throw new AppError(40001, `${def.name} 尚未开放`, 400);
    validateCapabilityParams(dto.capability, dto.params);
    // 能力特有的强校验（如详情图的模块键）：必须在拆单 / 扣费之前拦截，
    // 不允许「显式传错模块」被静默回落成默认 6 项并照收 6 份钱。
    def.validateParams?.(dto.params ?? {});

    /*
     * 3. 后台上下线管控。
     *
     * 必须排在素材 / 项目归属校验之前：能力下线时用户需要看到「已下线 + 原因」，
     * 而不是「项目不存在」或「素材无权限」这种与真正原因无关的报错。
     * 也必须在扣费之前 —— 为一次根本不存在的服务付费是资损。
     */
    const availability = await this.availability.runtimeOf(dto.capability);
    if (availability && !availability.enabled) {
      throw new AppError(40005, availability.reason || `${def.name} 已暂时下线`, 400);
    }

    // 4. 输入素材：数量、重复、空 id（先做便宜的字符串校验，再查库）
    if (dto.inputAssetIds.length > MAX_INPUT_ASSETS) {
      throw new AppError(40001, `一次最多提交 ${MAX_INPUT_ASSETS} 张输入图片`, 400);
    }
    // 能力自己的张数约定（如带货图文最多 5 张）优先于全局上限
    if (def.maxInputs !== undefined && dto.inputAssetIds.length > def.maxInputs) {
      throw new AppError(
        40001,
        `${def.name} 最多支持 ${def.maxInputs} 张输入图片（当前 ${dto.inputAssetIds.length} 张）`,
        400,
      );
    }
    if (dto.inputAssetIds.some((id) => !id?.trim())) {
      throw new AppError(40001, '输入素材 id 不能为空', 400);
    }
    if (new Set(dto.inputAssetIds).size !== dto.inputAssetIds.length) {
      throw new AppError(40001, '输入素材不能重复', 400);
    }
    if (dto.inputAssetIds.length < def.inputs) {
      throw new AppError(
        40001,
        `${def.name} 需要上传 ${def.inputs} 张图片（当前 ${dto.inputAssetIds.length} 张）`,
        400,
      );
    }

    // 5. 会员权益：并发上限与快速通道随任务快照落库，由 worker 在领取任务时
    //    按「当前执行中任务数」分批调度；提交阶段不因并发上限拒绝请求。
    const perks = await this.membership.perksOf(ownerId);

    // 6. 项目与素材归属（两条查询互不依赖，并行取回）
    const [project, assets] = await Promise.all([
      this.prisma.project.findFirst({
        where: { id: dto.projectId, deletedAt: null },
      }),
      /*
       * 素材库按账号展示全部项目素材，用户可以在任意工作台选择历史素材。
       * 项目是组织维度而不是鉴权边界，因此这里只校验 ownerId；若再要求
       * asset.projectId === dto.projectId，跨项目选择会误报「不存在或无权限」。
       * 任务产出仍写入 dto.projectId，输入素材保持原归属，便于用户追溯。
       */
      this.prisma.asset.findMany({
        where: {
          id: { in: dto.inputAssetIds },
          ownerId,
          status: 'visible',
          project: { deletedAt: null },
        },
      }),
    ]);
    if (!project || project.ownerId !== ownerId) {
      throw new AppError(40001, '项目不存在或无权限', 403);
    }
    if (assets.length !== dto.inputAssetIds.length) {
      throw new AppError(40001, '部分输入素材不存在或无权限', 400);
    }

    // 7. 遮罩与局部重绘标注（都是生成输入，必须在扣费前确认可用）
    await this.validateMask(ownerId, dto, assets);
    const sanitized = sanitizeParams(dto.capability, dto.params);
    const sourceAsset = assets.find((asset: { id: string }) => asset.id === dto.inputAssetIds[0]);
    await this.validateAnnotations(ownerId, dto, sourceAsset);
    this.assertLocalRedrawHasInput(dto, sanitized);

    // 8. 模型解析：能力 + 所选模型分组；具体线路由选路器在同一候选池内决定
    const modelKey = String(dto.modelKey ?? '').trim();
    if (!modelKey) {
      throw new AppError(40005, '请选择用于本次生成的模型', 400);
    }
    const access = await this.groups.accessForUser(ownerId);
    const intent = def.model.intent(sanitized, { image: dto.inputAssetIds.length, video: 0 });
    // 选路失败（模型不存在 / 无可用线路 / 参数组合无线路可承接）由 router 抛可读原因
    const routed = await this.router.resolve(access, dto.capability, modelKey, intent);
    const imageInput = routed.capabilitySpec.inputs?.image;
    const imageCount = dto.inputAssetIds.length;
    if (imageInput && (imageCount < imageInput.min || imageCount > imageInput.max)) {
      const range =
        imageInput.min === imageInput.max
          ? `${imageInput.max}`
          : `${imageInput.min}-${imageInput.max}`;
      throw new AppError(
        40001,
        `所选模型「${routed.modelKey}」仅支持 ${range} 张输入图片（当前 ${imageCount} 张），请调整图片数量或更换模型`,
        400,
      );
    }

    // 9. 遮罩线路能力：没有编辑端点的线路做遮罩重绘等于整图重绘
    const maskAssetId = this.maskAssetId(sanitized);
    if (maskAssetId && routed.capabilitySpec.inputs?.mask === undefined) {
      throw new AppError(42205, '当前线路不支持遮罩重绘，请更换模型', 400);
    }

    /*
     * 10. 计价：价格快照与目录报价同源；能力售价由 `CapabilityPricing` 唯一提供。
     * 限时免费在草案之后把金额直接置 0，并记下活动 id 供账单追溯。
     */
    let draft = this.billing.buildDraft(access, routed);
    if (dto.capability === 'multi_fusion') {
      draft = scaleMultiFusionDraft(draft, sanitized);
    }
    const freeCampaignId = await this.price.freeCampaignIdOf(dto.capability, ownerId);
    const amountMicrocredits = freeCampaignId ? 0n : draft.amountMicrocredits;
    const creditCost = microcreditsToCredits(amountMicrocredits);

    // 11. 局部重绘参考图的文字描述（只做一次，落进任务参数避免每次轮询重算）
    if (dto.capability === 'local_redraw') {
      const annotations = parseLocalRedrawAnnotations(sanitized.annotations);
      const hasReferenceImages = annotations.some((item) => Boolean(item.referenceAssetId));
      if (hasReferenceImages && amountMicrocredits > 0n) {
        const available = await this.billing.availableMicrocreditsOf(ownerId);
        if (available < amountMicrocredits) {
          throw new AppError(40201, '积分不足，请充值后再试', 402);
        }
      }
      await this.attachReferenceHints(sanitized, ownerId);
    }

    // 12. 多图产出：能力可把一次提交拆成 N 张图（详情图按模块逐张出图）
    //
    // **每张各自计费**。价目表里的价是「一张图」的价：勾 6 个模块就是 6 × 单价。
    // 每张都有自己的账单，失败 / 取消各自按自己的账单退款 —— 一张失败不连累
    // 同批其它图，也不会出现「整套没出来却只退了一张的钱」。
    const planned = def.outputPlan?.(sanitized) ?? [];
    const outputs = planned.length > 0 ? planned : null;
    const batchId = outputs && outputs.length > 1 ? randomUUID() : undefined;
    const batchSize = outputs?.length ?? 0;
    const paramsFor = (index: number): Record<string, any> => ({
      ...sanitized,
      __memberFastChannel: perks.fastChannel,
      // 并发上限随任务快照落库：worker 领取时按它分批，不要求用户计划在
      // 任务排队期间保持不变（与会员权益快照口径一致）。
      __memberConcurrency: perks.maxConcurrent,
      ...(outputs ? outputs[index].params : {}),
      /*
       * 批次字段只允许服务端写入。N=1 时显式置空，避免调用方自带的
       * `batchId/batchIndex/batchSize` 落库，被幂等重放当成更大的批次。
       * JSON.stringify 会丢掉 undefined，单图任务因此不会带这些键。
       */
      ...(batchId
        ? { batchId, batchIndex: index + 1, batchSize }
        : { batchId: undefined, batchIndex: undefined, batchSize: undefined }),
    });
    /** 子任务与父任务共用同一份线路与价格快照，各自承担一份计费 */
    const taskBase: Omit<Prisma.GenerationTaskUncheckedCreateInput, 'params'> = {
      projectId: dto.projectId,
      ownerId,
      capability: dto.capability,
      status: 'queued',
      stage: '排队中',
      progress: 0,
      inputAssetIds: JSON.stringify(dto.inputAssetIds),
      modelKey: routed.modelKey,
      channelModelId: routed.channelModel.id,
      channelId: routed.channelModel.channelId,
      routeRun: 1,
      heartbeatAt: new Date(),
    };

    /*
     * 13. 建任务 + 建账单 + 预留积分：**同一个事务**。
     *
     * 为什么必须同事务：账单要挂 taskId，所以看起来只能「先建任务再预留」。
     * 但那样进程在两步之间崩溃会留下「排队中但没有账单」的任务 ——
     * 用户已授权、任务却永远不动。旧实现靠 `recoverUnbilledQueued` 补偿，
     * 那是兜底不是设计。现在把三步放进一个 Prisma 事务：
     *   · 余额不足 → 整批任务与账单一起回滚，不留半个任务；
     *   · 崩溃 → 事务整体回滚，要么全有要么全无。
     *
     * 幂等键的并发处理留在事务外：唯一约束冲突时要回查赢家任务，
     * 在事务内回查会看到未提交的行。
     */
    const taskIds = await this.createTasksWithBilling({
      ownerId,
      idempotencyKey,
      requestFingerprint,
      creditCost,
      taskBase,
      paramsFor,
      outputs,
      draft,
      amountMicrocredits,
      freeCampaignId,
    }).catch(async (error: unknown): Promise<string[] | AdmissionResult> => {
      // 同一幂等键的并发请求：唯一约束只放一个进来，失败方拿回赢家任务
      if (idempotencyKey && (error as { code?: string })?.code === 'P2002') {
        const existing = await this.prisma.generationTask.findUnique({
          where: { ownerId_idempotencyKey: { ownerId, idempotencyKey } },
        });
        if (existing) return toIdempotentResult(existing, requestFingerprint!);
      }
      if (error instanceof AppError && error.code === 40002) {
        throw new AppError(40201, error.message, 402);
      }
      throw error;
    });
    if (!Array.isArray(taskIds)) return taskIds; // 幂等命中：直接返回赢家任务

    // 事务提交后取回首张任务（返回体需要状态与展示价）
    const task = await this.prisma.generationTask.findUnique({
      where: { id: taskIds[0] },
      select: { id: true, status: true, creditCost: true },
    });
    if (!task) throw new AppError(50001, '任务创建后读取失败', 500);

    return {
      taskId: task.id,
      status: 'queued',
      // 本次合计：N 张各自一张账单，前端按这个数提示用户付了多少
      creditCost: creditCost * taskIds.length,
      idempotentHit: false,
      ...(batchId ? { batchId, batchSize } : {}),
    };
  }

  /**
   * 建任务 + 建账单 + 预留积分，**同一个事务**。
   *
   * 账单要挂 taskId，所以直觉上只能「先建任务再预留」。但那样进程在两步之间
   * 崩溃会留下「排队中但没有账单」的任务 —— 用户已授权、任务却永远不动。
   * 旧实现靠 `recoverUnbilledQueued` 补偿，那是兜底不是设计。三步放进一个
   * Prisma 事务后：
   *   · 余额不足 → 整批任务与账单一起回滚，不留半个任务；
   *   · 进程崩溃 → 事务整体回滚，要么全有要么全无。
   *
   * 多图产出每张一条账单、各自独立结算与退款，但**整批同生共死**。
   */
  private async createTasksWithBilling(params: {
    ownerId: string;
    idempotencyKey?: string;
    requestFingerprint?: string;
    creditCost: number;
    taskBase: Omit<Prisma.GenerationTaskUncheckedCreateInput, 'params'>;
    paramsFor: (index: number) => Record<string, any>;
    outputs: Array<{ params: Record<string, any> }> | null;
    draft: BillingDraft;
    amountMicrocredits: bigint;
    freeCampaignId?: string;
  }): Promise<string[]> {
    const {
      ownerId,
      idempotencyKey,
      requestFingerprint,
      creditCost,
      taskBase,
      paramsFor,
      outputs,
      draft,
    } = params;
    return this.prisma.$transaction(async (tx) => {
      // 项目校验与任务落库之间可能隔着模型解析、计价等步骤；后台软删项目
      // 若恰好发生在这段窗口内，必须在扣费事务内再次拒绝，避免任务/账单
      // 落进一个已经删除的项目。
      const activeProject = await tx.project.findFirst({
        where: { id: taskBase.projectId, ownerId, deletedAt: null },
        select: { id: true },
      });
      if (!activeProject) {
        throw new AppError(40001, '项目不存在或无权限', 403);
      }

      const ids: string[] = [];
      const parent = await tx.generationTask.create({
        data: {
          ...taskBase,
          params: JSON.stringify(paramsFor(0)),
          idempotencyKey,
          requestFingerprint,
          creditCost,
        },
        select: { id: true },
      });
      ids.push(parent.id);
      for (let index = 1; outputs && index < outputs.length; index += 1) {
        const child = await tx.generationTask.create({
          data: {
            ...taskBase,
            params: JSON.stringify(paramsFor(index)),
            creditCost,
            parentTaskId: parent.id,
          },
          select: { id: true },
        });
        ids.push(child.id);
      }

      // 每张图一条账单，整批在**同一个事务**里预留：余额不够付整批就是整批不成立
      const reserved = await this.billing.reserveBatchBilling({
        userId: ownerId,
        // 首轮账单的幂等键按任务区分：切线时的替换账单用另一套键
        items: ids.map((taskId) => ({ taskId, idempotencyKey: `task:${taskId}` })),
        draft: { ...draft, amountMicrocredits: params.amountMicrocredits },
        promotionId: params.freeCampaignId || undefined,
        tx,
      });
      for (const item of reserved) {
        await tx.generationTask.update({
          where: { id: item.taskId },
          data: {
            billingOrderId: item.order.id,
            authorizedChargeMicrocredits: item.reserved,
          },
        });
      }
      return ids;
    });
  }

  // ── 校验 ──────────────────────────────────────────────────────────

  /**
   * 遮罩素材：属于本人 + 上传素材 + PNG + 与原图同尺寸。
   *
   * 不要求与原图同项目 —— 遮罩是前端按原图现画现传的，用户可能在别的项目
   * 传过同一张底图，强行要求同项目只会让人莫名传两遍。
   */
  private async validateMask(
    ownerId: string,
    dto: CreateGenerationDto,
    assets: Array<{ id: string; width: number | null; height: number | null }>,
  ): Promise<void> {
    const maskAssetId = this.maskAssetId(dto.params);
    if (!maskAssetId) return;
    const maskAsset = await this.prisma.asset.findFirst({
      where: {
        id: maskAssetId,
        ownerId,
        kind: 'original',
        status: 'visible',
        project: { deletedAt: null },
      },
      select: { id: true, format: true, width: true, height: true },
    });
    if (!maskAsset) throw new AppError(40001, '遮罩素材不存在或无权限', 400);
    if (maskAsset.format && maskAsset.format !== 'image/png') {
      throw new AppError(40001, '遮罩必须使用 PNG 格式', 400);
    }
    const source = assets.find((asset) => asset.id === dto.inputAssetIds[0]);
    if (
      source?.width &&
      source?.height &&
      maskAsset.width &&
      maskAsset.height &&
      (source.width !== maskAsset.width || source.height !== maskAsset.height)
    ) {
      throw new AppError(
        40001,
        `遮罩尺寸必须与原图一致（原图 ${source.width}×${source.height}，遮罩 ${maskAsset.width}×${maskAsset.height}）`,
        400,
      );
    }
  }

  /** 局部重绘标注：1–3 项、每项有区域描述、多区域带合法坐标、参考图属于本人 */
  private async validateAnnotations(
    ownerId: string,
    dto: CreateGenerationDto,
    sourceAsset?: { width: number | null; height: number | null },
  ): Promise<void> {
    if (dto.capability !== 'local_redraw') return;
    const raw = dto.params?.annotations;
    if (raw === undefined || raw === null || raw === '') return;
    if (typeof raw !== 'string') {
      throw new AppError(40001, 'annotations 必须是 JSON 字符串', 400);
    }

    let decoded: unknown;
    try {
      decoded = JSON.parse(raw);
    } catch {
      throw new AppError(40001, 'annotations 必须是合法 JSON', 400);
    }
    if (!Array.isArray(decoded) || decoded.length === 0 || decoded.length > 3) {
      throw new AppError(40001, 'annotations 必须是 1 至 3 项数组', 400);
    }
    if (parseLocalRedrawAnnotations(raw).length !== decoded.length) {
      throw new AppError(40001, '每个标注都必须包含非空区域描述', 400);
    }

    for (const item of decoded) {
      const record = item as Record<string, unknown>;
      const bounds = normalizeLocalRedrawBounds(record.bounds);
      if (record.bounds !== undefined) {
        if (!bounds) throw new AppError(40001, '标注区域坐标无效', 400);
        if (
          sourceAsset?.width &&
          sourceAsset.height &&
          (bounds.sourceWidth !== sourceAsset.width || bounds.sourceHeight !== sourceAsset.height)
        ) {
          throw new AppError(40001, '标注区域坐标与原图尺寸不一致', 400);
        }
      } else if (decoded.length > 1) {
        throw new AppError(40001, '多区域标注必须为每个区域提供坐标', 400);
      }
    }

    const referenceIds = parseLocalRedrawAnnotations(raw)
      .map((item) => item.referenceAssetId)
      .filter((id): id is string => typeof id === 'string' && Boolean(id.trim()));
    for (const referenceId of new Set(referenceIds)) {
      const reference = await this.prisma.asset.findFirst({
        where: {
          id: referenceId,
          ownerId,
          kind: 'original',
          status: 'visible',
          project: { deletedAt: null },
        },
        select: { id: true },
      });
      if (!reference) throw new AppError(40001, '局部重绘参考图素材不存在或无权限', 400);
    }
  }

  /** 局部重绘至少需要遮罩、文字描述或标注之一；空白字符串不算输入。 */
  private assertLocalRedrawHasInput(
    dto: CreateGenerationDto,
    sanitized: Record<string, any>,
  ): void {
    if (dto.capability !== 'local_redraw') return;
    const prompt = typeof sanitized.prompt === 'string' ? sanitized.prompt.trim() : '';
    const annotations = parseLocalRedrawAnnotations(sanitized.annotations);
    if (this.maskAssetId(sanitized) || prompt || annotations.length > 0) return;
    throw new AppError(40001, '请至少提交遮罩、重绘描述或标注区域之一', 400);
  }

  /**
   * 参考图 → 文字描述，写进 `params.__referenceHints`。
   *
   * 任何一张参考图解析失败都只跳过，不让整单失败：参考图是增强信息，
   * 主体仍是原图 + 遮罩 + 区域描述。
   */
  private async attachReferenceHints(params: Record<string, any>, ownerId: string): Promise<void> {
    const annotations = parseLocalRedrawAnnotations(params.annotations);
    const hints = (
      await Promise.all(
        annotations.map(async (item) => {
          if (typeof item.referenceAssetId !== 'string' || !item.referenceAssetId.trim())
            return null;
          try {
            const result = await this.promptTools.imageToPrompt(
              ownerId,
              item.referenceAssetId,
              item.instruction,
            );
            const text = result.text?.trim();
            return text ? `${item.label || '参考图'}：${text}` : null;
          } catch (error) {
            this.log.warn(
              `局部重绘参考图 ${item.referenceAssetId} 转描述失败，已跳过：${(error as Error).message}`,
            );
            return null;
          }
        }),
      )
    ).filter((hint): hint is string => Boolean(hint));
    if (hints.length > 0) params.__referenceHints = hints;
  }

  /** 遮罩素材 id（局部重绘沿用 `modelGuideAssetId`，通用入口是 `maskAssetId`） */
  private maskAssetId(params: Record<string, any> | undefined): string {
    const raw = params?.modelGuideAssetId ?? params?.maskAssetId;
    return typeof raw === 'string' ? raw.trim() : '';
  }
}

// ── 工具 ────────────────────────────────────────────────────────────

function toResult(
  task: { id: string; status: string; creditCost: number; params?: string | null },
  idempotentHit: boolean,
): AdmissionResult {
  // 幂等命中要带回同一批次的标识，否则前端会把「重试」当成一次单图生成
  let batchId: string | undefined;
  let batchSize: number | undefined;
  try {
    const params = JSON.parse(task.params || '{}');
    if (typeof params.batchId === 'string' && params.batchId) {
      batchId = params.batchId;
      batchSize = Number(params.batchSize) || undefined;
    }
  } catch {
    // 参数损坏的存量任务按单图处理
  }
  return {
    taskId: task.id,
    status: task.status,
    // 任务上是单张价；幂等命中时按批次张数还原合计，和首次返回保持同一口径
    creditCost: task.creditCost * (batchSize && batchSize > 1 ? batchSize : 1),
    idempotentHit,
    ...(batchId ? { batchId, batchSize } : {}),
  };
}

/**
 * 幂等键只能复用**同一份生成请求**。旧任务没有指纹时无法证明请求一致，
 * 因而宁可直接拒绝并让客户端换键，也不能返回一个内容可能完全不同的任务。
 */
function toIdempotentResult(
  task: {
    id: string;
    status: string;
    creditCost: number;
    params?: string | null;
    requestFingerprint?: string | null;
  },
  fingerprint: string,
): AdmissionResult {
  if (!task.requestFingerprint) {
    throw new AppError(40900, '该幂等键对应的旧任务缺少请求指纹，请更换幂等键后重试', 409);
  }
  if (task.requestFingerprint !== fingerprint) {
    throw new AppError(40900, '幂等键已用于不同请求，请更换幂等键或复用原请求', 409);
  }
  return toResult(task, true);
}

/**
 * 原始生成请求的稳定指纹。
 *
 * 参数对象递归按 key 排序；数组及输入素材顺序保持不变，因为它们本身会影响
 * 生成语义。这样客户端只是调整 JSON 字段顺序时仍能命中幂等，而项目、模型、
 * 素材或任一参数发生变化时会被识别为冲突。
 */
export function generationRequestFingerprint(
  dto: Pick<
    CreateGenerationDto,
    'projectId' | 'capability' | 'modelKey' | 'inputAssetIds' | 'params'
  >,
): string {
  const canonical = {
    projectId: String(dto.projectId ?? ''),
    capability: String(dto.capability ?? ''),
    modelKey: String(dto.modelKey ?? '').trim(),
    inputAssetIds: (dto.inputAssetIds ?? []).map((id) => String(id)),
    params: canonicalizeJson(dto.params ?? {}),
  };
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

function canonicalizeJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizeJson);
  if (value && typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((out, key) => {
        const item = (value as Record<string, unknown>)[key];
        if (item !== undefined) out[key] = canonicalizeJson(item);
        return out;
      }, {});
  }
  return value;
}

/** 微积分 → 展示用积分（向上取整，避免 0.4 积分显示成 0） */
function microcreditsToCredits(microcredits: bigint): number {
  const scale = 1_000_000n;
  return Number((microcredits + scale - 1n) / scale);
}

/** 请求体字段与 Idempotency-Key 头二选一；同时给出时必须一致 */
export function normalizeIdempotencyKey(
  bodyValue?: string,
  headerValue?: string,
): string | undefined {
  const body = typeof bodyValue === 'string' ? bodyValue.trim() : '';
  const header = typeof headerValue === 'string' ? headerValue.trim() : '';
  if (body && header && body !== header) {
    throw new AppError(40001, '请求体与 Idempotency-Key 头的幂等键不一致', 400);
  }
  const key = body || header;
  if (!key) return undefined;
  if (!IDEMPOTENCY_KEY_RE.test(key)) {
    throw new AppError(40001, '幂等键必须是 8-128 位字母、数字或 . _ : -', 400);
  }
  return key;
}
