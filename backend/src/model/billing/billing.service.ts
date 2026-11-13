/**
 * 生成账单：预留 → 运行 → 结算 / 退款。
 *
 * 移植自 open-ai-canvas `internal/app/finance.go` + `internal/repository/finance_billing.go`：
 * Token 补扣、授权上限截断、按秒重算、uncertain 人工核对的口径都与参考实现一致；
 * 资金落账统一走 `CreditWalletService`，批次 FEFO 与到期回填由它维护。
 *
 * 四条不可违背的规则：
 * 1. 建单与预留同一事务 —— 先建单后预留失败会留下一张永远不会结算的账单；
 * 2. 已结算账单不允许自动退款（只能人工处理），已退款账单不允许再结算；
 * 3. Token 结算以上游 usage 为准；用量缺失时要么按提交时的公式快照（视频），
 *    要么显式失败转人工，绝不按预授权金额静默结清；
 * 4. `chargeLimit` 生效时，Token 结算按上限截断（事后计量只能收这么多），
 *    按秒结算超限则拒绝 —— 自动扣费不能突破用户授权。
 */

import { Injectable } from '@nestjs/common';
import type { BillingOrder, Prisma } from '@prisma/client';
import { AppError } from '../../common/app.exception';
import { PrismaService } from '../../prisma/prisma.service';
import { estimateTextTokens, requestedBillingQuantity } from '../catalog/quote.service';
import { normalizeCapability } from '../domain/capability-config';
import { badRequest } from '../domain/json';
import {
  BASIS_POINTS_SCALE,
  CREDIT_SCALE,
  convertCurrencyPrice,
  creditAmount,
  tokenAmount,
} from '../infra/microcredits';
import type { ModelRequestIntent } from '../intent/spec-types';
import { PriceTierService } from '../routing/price-tier.service';
import type { CachedChannelModel, CachedPriceTier, RoutedModel } from '../routing/routing.types';
import type { UserGroupAccess } from '../user-groups/user-group.service';
import { CreditWalletService } from './credit-wallet.service';

/** 账单状态机：reserved → running → settled / refunded，异常停在 uncertain */
export const BILLING_STATUSES = [
  'reserved',
  'running',
  'settled',
  'refunded',
  'uncertain',
] as const;
export type BillingStatus = (typeof BILLING_STATUSES)[number];

/**
 * 退款归类 —— 决定这笔退款算不算「用户拿回的钱」。
 *
 * `route_switch` 是唯一**不计入「已退」**的一类：线路切换时旧账单的预授权
 * 只是挪到新账单，钱没有离开平台。把它算进已退会让一次成功的换线任务显示
 * 净收入为负。其余分类都是真实退款。
 */
export type RefundReason =
  | 'failure'
  | 'manual'
  | 'proxy_timeout'
  | 'auto_sweep'
  | 'route_switch'
  | '';

/** 结算用量来源：上游 usage 优先，视频可退到提交时的公式快照 */
export const USAGE_SOURCE_PROVIDER = 'provider';
export const USAGE_SOURCE_VIDEO_FORMULA = 'video_formula';

/** Prisma 账单行（各调用方直接复用，避免重复 import Prisma） */
export type BillingOrderRow = BillingOrder;

/** `running` 超过该时长仍未完成，才允许人工核对 */
export const REVIEW_RUNNING_STALE_MS = 40 * 60_000;

/** 人工核对需要读取的任务信息，避免把整个 GenerationTask 带进判定函数 */
export interface BillingReviewTask {
  status: string;
  outputAssetId: string | null;
  pendingResult: string | null;
  mediaRecoveryError: string | null;
}

/**
 * 人工处置资格的唯一判定口径。
 *
 * 列表、详情、批量选择和真正执行 resolve 都必须调用这一处：
 *   · 仍在补交付（running + pendingResult / mediaRecoveryError）的任务永远不可核对；
 *   · 退款：已有产出的订单一律不可退，避免「拿到图又退钱」；
 *   · 结算：已交付的订单必须可结算 —— 结算失败或进程在落结果与结算之间崩溃时，
 *     账单会停在 reserved / running / uncertain，若按「已有产出」一刀切拒绝，
 *     这笔预授权就永远没有人工出口；
 *   · uncertain 永远可核对；running 仅在超过 40 分钟时视为执行者可能已死；
 *   · reserved 只有在对应任务明确 failed / cancelled 时才可**退款**（不可结算）。
 *
 * 单纯的 reserved / 新鲜 running 仍可能正常执行，提前人工退款会让平台
 * 白付上游成本，并可能在任务继续执行时造成重复交付。
 */
export type BillingReviewAction = 'settle' | 'refund';

export function isBillingOrderReviewable(
  order: Pick<BillingOrder, 'status' | 'updatedAt'>,
  task?: BillingReviewTask | null,
  now = Date.now(),
  action: BillingReviewAction = 'refund',
): boolean {
  // `mediaRecoveryError` 也被普通失败路径用作错误说明；只有任务仍在运行且
  // 正在重试落盘时才算「正在补交付」。`pendingResult` 无论任务状态如何都存在
  // 二次交付可能，必须一并排除。
  const recovering =
    task?.pendingResult != null ||
    (task != null && task.status === 'running' && task.mediaRecoveryError != null);
  if (recovering) return false;
  if (order.status === 'settled' || order.status === 'refunded') return false;

  const delivered = task?.outputAssetId != null;
  if (delivered) {
    // 已交付只能结算，不能退款；非终态账单都允许结算。
    return action === 'settle';
  }

  if (order.status === 'uncertain') return true;
  if (order.status === 'running') {
    return now - order.updatedAt.getTime() > REVIEW_RUNNING_STALE_MS;
  }
  if (order.status === 'reserved') {
    // 预授权对应的任务已失败 / 取消时，只能退款；结算会把一次未交付的任务变成收费。
    return action === 'refund' && (task?.status === 'failed' || task?.status === 'cancelled');
  }
  return false;
}

/** 一次结算所用的上游用量 */
export interface BillingUsage {
  inputTokens: bigint;
  outputTokens: bigint;
  cachedTokens: bigint;
}

/** 建单所需的全部价格快照（金额已是微积分，不含成本列） */
export interface BillingDraft {
  model: string;
  capability: string;
  scene: string;
  billingMode: string;
  channelId: string;
  channelModelId: string;
  priceTierId: string;
  priceTierVersion: number;
  priceSelectorJson: string;
  priceVersion: number;
  unitPriceMicrocredits: bigint;
  multiplierBasisPoints: bigint;
  userGroup: string;
  priceCurrency: string;
  currencyRateMicrocredits: bigint;
  quantity: bigint;
  amountMicrocredits: bigint;
  inputTokenPriceMicrocredits: bigint;
  outputTokenPriceMicrocredits: bigint;
  cachedTokenPriceMicrocredits: bigint;
  inputTokens: bigint;
  outputTokens: bigint;
  cachedTokens: bigint;
  videoFormulaTokens: bigint;
  /**
   * 成本价快照（仅后台可见，不叠倍率、不参与售价）。
   *
   * 与参考实现 `BillingCostSnapshot` 同口径：建单时把命中价格档的成本写入账单，
   * 换线时随线路一起更新 —— 毛利分析才是真实的。
   * `costConfigured=false` 表示该档位未配成本，账单成本留空而不是记 0。
   */
  costConfigured: boolean;
  costUnitPriceMicrocredits: bigint;
  costInputTokenPriceMicrocredits: bigint;
  costOutputTokenPriceMicrocredits: bigint;
  costCachedTokenPriceMicrocredits: bigint;
  costBillingMode: string;
  costQuantity: bigint;
  costVideoFormulaTokens: bigint;
}

/** 预估文本用量；图片 / 视频固定价通道不使用 */
export function estimatedTextUsage(intent: ModelRequestIntent): BillingUsage {
  const estimate = estimateTextTokens(intent);
  return {
    inputTokens: BigInt(estimate.inputTokens),
    outputTokens: BigInt(estimate.outputTokens),
    cachedTokens: 0n,
  };
}

/** 授权上限是否生效：显式设置过即生效（含授权为 0 的免费单） */
export function chargeLimitApplies(order: {
  chargeLimitSet: boolean;
  chargeLimitMicrocredits: bigint;
}): boolean {
  return order.chargeLimitSet || order.chargeLimitMicrocredits > 0n;
}

/** 金额越过授权上限即拒绝，不静默截断（截断只发生在 Token 结算的事后计量里） */
export function validateChargeLimit(
  order: { chargeLimitSet: boolean; chargeLimitMicrocredits: bigint },
  amount: bigint,
): void {
  if (amount < 0n) throw badRequest('计费金额无效');
  if (chargeLimitApplies(order) && amount > order.chargeLimitMicrocredits) {
    throw badRequest('本次请求费用超出授权上限');
  }
}

/** 失败是否可能已经打到上游：命中这些标记一律转人工，不自动退款 */
export function billingFailureUncertain(error: unknown): boolean {
  if (!error) return false;
  const message = String(error instanceof Error ? error.message : error).toLowerCase();
  return [
    '524',
    'timeout',
    '超时',
    'deadline exceeded',
    'context canceled',
    'connection reset',
    'unexpected eof',
    'broken pipe',
  ].some((marker) => message.includes(marker));
}

/** 零价 Token 单不需要 usage 就能结清（免费模型 / 限时免费） */
export function zeroPricedTokenOrder(order: {
  billingMode: string;
  inputTokenPriceMicrocredits: bigint;
  outputTokenPriceMicrocredits: bigint;
  cachedTokenPriceMicrocredits: bigint;
}): boolean {
  return (
    order.billingMode === 'token' &&
    order.inputTokenPriceMicrocredits === 0n &&
    order.outputTokenPriceMicrocredits === 0n &&
    order.cachedTokenPriceMicrocredits === 0n
  );
}

@Injectable()
export class BillingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: CreditWalletService,
    private readonly priceTiers: PriceTierService,
  ) {}

  /**
   * 只读余额预检查。
   *
   * 真正的余额权威校验仍在建单事务内（`reserveBatchBilling`）；这里用于在
   * 触发有成本的上游调用（例如局部重绘参考图转描述）之前，尽早拒绝明显
   * 余额不足的请求。调用方不能把这里的快照当成预留成功的依据。
   */
  async availableMicrocreditsOf(userId: string): Promise<bigint> {
    const balance = await this.wallet.balanceOf(this.prisma, userId);
    return balance.availableMicrocredits;
  }

  // ── 建单 ──────────────────────────────────────────────────────────

  /**
   * 按已解析线路构造价格快照。
   *
   * `channel` 策略读价格档单价并按分组货币换算；`unified` 读前台模型标量价。
   * 两种策略都必须用同一次 `routed` —— 换一条线路就是换一份价格，
   * 账单与目录报价必须同源，否则「看到的价」与「扣的钱」会打架。
   * 售价唯一来源是能力目录里的 `CapabilityPricing`。
   */
  buildDraft(access: UserGroupAccess, routed: RoutedModel): BillingDraft {
    const capability = normalizeCapability(routed.intent.capability);
    if (!capability) throw badRequest('模型能力类型无效');
    if (!routed.pricing.configured) throw badRequest('当前能力尚未配置售价');

    // 分组是账单的强校验边界：目录里看不到的渠道，即使被直接提交也不能预留积分
    access.requireChannel(routed.channelModel.channelId);

    /*
     * 售价在能力级；成本快照按本次意图命中的成本档记录，仅用于后台毛利分析。
     */
    const pricing = access.pricing('credits', [
      routed.capabilityId,
      routed.modelKey,
      routed.channelModel.modelKey,
    ]);
    const costTier = this.priceTiers.tierForIntent(routed.channelModel, routed.intent);

    const draft: BillingDraft = {
      model: routed.modelKey,
      capability,
      scene: truncate(String(routed.intent.operation ?? capability), 80),
      billingMode: routed.pricing.billingMode,
      channelId: routed.channelModel.channelId,
      channelModelId: routed.channelModel.id,
      priceTierId: costTier?.id ?? '',
      priceTierVersion: costTier?.priceVersion ?? 0,
      priceSelectorJson: costTier?.selectorJson ?? '{}',
      priceVersion: routed.catalogVersion,
      unitPriceMicrocredits: BigInt(routed.pricing.unitPriceMicrocredits),
      multiplierBasisPoints: pricing.multiplierBasisPoints,
      userGroup: access.groupCode,
      priceCurrency: pricing.currency,
      currencyRateMicrocredits: pricing.rateMicrocredits,
      quantity: 1n,
      amountMicrocredits: 0n,
      inputTokenPriceMicrocredits: BigInt(routed.pricing.inputTokenPriceMicrocredits),
      outputTokenPriceMicrocredits: BigInt(routed.pricing.outputTokenPriceMicrocredits),
      cachedTokenPriceMicrocredits: BigInt(routed.pricing.cachedTokenPriceMicrocredits),
      inputTokens: 0n,
      outputTokens: 0n,
      cachedTokens: 0n,
      videoFormulaTokens: 0n,
      // 成本价恒为微积分：不叠分组倍率、不做货币换算，也不参与售价计算
      costConfigured: Boolean(costTier?.costConfigured),
      costUnitPriceMicrocredits: BigInt(costTier?.costUnitPriceMicrocredits ?? 0),
      costInputTokenPriceMicrocredits: BigInt(costTier?.costInputTokenPriceMicrocredits ?? 0),
      costOutputTokenPriceMicrocredits: BigInt(costTier?.costOutputTokenPriceMicrocredits ?? 0),
      costCachedTokenPriceMicrocredits: BigInt(costTier?.costCachedTokenPriceMicrocredits ?? 0),
      costBillingMode: costTier?.billingMode ?? routed.pricing.billingMode,
      costQuantity: 0n,
      costVideoFormulaTokens: 0n,
    };
    return this.withAmount(draft, routed.intent, false);
  }

  /**
   * 中转请求的建单快照：只有「渠道价」，没有前台模型。
   *
   * 中转入口（`src/model/proxy/**`）由调用方直接指定渠道模型，用户看到的价
   * 必须与同一渠道模型在任务路径上的价一致 —— 因此这里复用 `withAmount`，
   * 而不是在中转侧再写一份金额公式。价格档由调用方按请求参数选好后传入：
   * 选档依赖 `PriceTierService`，本服务不反向依赖路由层。
   *
   * 未配置价格时**拒绝**而不是建 0 元账单：中转是公开入口，0 元等于免费放行。
   */
  buildChannelDraft(
    access: UserGroupAccess,
    channelModel: CachedChannelModel,
    tier: CachedPriceTier,
    intent: ModelRequestIntent,
    scene: string,
  ): BillingDraft {
    const capability = normalizeCapability(channelModel.capability);
    if (!capability) throw badRequest('模型能力类型无效');
    if (!tier || !tier.priceConfigured)
      throw badRequest('当前模型尚未配置价格，暂不能通过中转调用');

    // 分组是账单的强校验边界：看不到的渠道即使知道地址也不能预留积分
    access.requireChannel(channelModel.channelId);

    const pricing = access.pricing(channelModel.priceCurrency, [channelModel.modelKey]);
    const draft: BillingDraft = {
      model: channelModel.modelKey,
      capability,
      scene: truncate(String(scene ?? 'proxy'), 80),
      billingMode: tier.billingMode,
      channelId: channelModel.channelId,
      channelModelId: channelModel.id,
      priceTierId: tier.id,
      priceTierVersion: tier.priceVersion,
      priceSelectorJson: tier.selectorJson,
      priceVersion: channelModel.priceVersion,
      unitPriceMicrocredits: convertCurrencyPrice(
        tier.unitPriceMicrocredits,
        pricing.rateMicrocredits,
      ),
      multiplierBasisPoints: pricing.multiplierBasisPoints,
      userGroup: access.groupCode,
      priceCurrency: pricing.currency,
      currencyRateMicrocredits: pricing.rateMicrocredits,
      quantity: 1n,
      amountMicrocredits: 0n,
      inputTokenPriceMicrocredits: convertCurrencyPrice(
        tier.inputTokenPriceMicrocredits,
        pricing.rateMicrocredits,
      ),
      outputTokenPriceMicrocredits: convertCurrencyPrice(
        tier.outputTokenPriceMicrocredits,
        pricing.rateMicrocredits,
      ),
      cachedTokenPriceMicrocredits: convertCurrencyPrice(
        tier.cachedTokenPriceMicrocredits,
        pricing.rateMicrocredits,
      ),
      inputTokens: 0n,
      outputTokens: 0n,
      cachedTokens: 0n,
      videoFormulaTokens: 0n,
      // 成本价恒为微积分：不叠分组倍率、不做货币换算，也不参与售价计算
      costConfigured: tier.costConfigured,
      costUnitPriceMicrocredits: BigInt(tier.costUnitPriceMicrocredits),
      costInputTokenPriceMicrocredits: BigInt(tier.costInputTokenPriceMicrocredits),
      costOutputTokenPriceMicrocredits: BigInt(tier.costOutputTokenPriceMicrocredits),
      costCachedTokenPriceMicrocredits: BigInt(tier.costCachedTokenPriceMicrocredits),
      costBillingMode: tier.billingMode,
      costQuantity: 0n,
      costVideoFormulaTokens: 0n,
    };
    return this.withAmount(draft, intent, true);
  }

  /** 按计费方式补全数量、估算用量与预授权金额 */
  private withAmount(
    draft: BillingDraft,
    intent: ModelRequestIntent,
    tierPriced: boolean,
  ): BillingDraft {
    const mode = draft.billingMode;

    if (mode === 'token') {
      if (draft.capability === 'video') {
        // 视频 Token 预授权依赖输出尺寸 / 帧率 / 参考素材时长换算（Seedance 公式）。
        // 当前没有 Token 计价的视频线路，先显式拒绝，不生成金额为 0 的假账单。
        throw badRequest('视频 Token 计费暂未开放');
      }
      if (draft.capability !== 'text')
        throw badRequest('当前供应线路不支持该能力的 Token 计费方式');
      if (draft.outputTokenPriceMicrocredits <= 0n)
        throw badRequest('当前模型尚未配置输出 Token 价格');
      const usage = estimatedTextUsage(intent);
      return {
        ...draft,
        amountMicrocredits: tokenAmount(
          {
            inputTokens: Number(usage.inputTokens),
            outputTokens: Number(usage.outputTokens),
            cachedTokens: 0,
            inputTokenPriceMicrocredits: draft.inputTokenPriceMicrocredits,
            outputTokenPriceMicrocredits: draft.outputTokenPriceMicrocredits,
            cachedTokenPriceMicrocredits: draft.cachedTokenPriceMicrocredits,
          },
          draft.multiplierBasisPoints,
        ),
        quantity: usage.inputTokens + usage.outputTokens,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        // 成本侧同样记录用量口径，便于按实际用量核算毛利
        costQuantity: usage.inputTokens + usage.outputTokens,
      };
    }

    if (mode === 'per_second') {
      const quantity = requestedBillingQuantity(draft.capability, intent.options);
      if (quantity <= 0) throw badRequest('当前模型按时长计费，但请求未提供有效时长');
      return {
        ...draft,
        quantity: BigInt(quantity),
        amountMicrocredits: creditAmount(
          draft.unitPriceMicrocredits,
          quantity,
          draft.multiplierBasisPoints,
        ),
        // 按秒计费的成本随秒数放大
        costQuantity: BigInt(quantity),
      };
    }

    if (mode !== 'fixed_request') throw badRequest('当前模型计费方式暂不支持');
    if (draft.unitPriceMicrocredits < 0n) throw badRequest('模型价格无效');
    // 渠道策略下价格为 0 意味着档位未配置；unified 的 0 是合法的免费模型
    if (tierPriced && draft.unitPriceMicrocredits === 0n)
      throw badRequest('当前模型尚未配置所选规格的价格');
    return {
      ...draft,
      amountMicrocredits: creditAmount(draft.unitPriceMicrocredits, 1, draft.multiplierBasisPoints),
    };
  }

  /**
   * 创建任务账单并预留积分。
   *
   * 幂等键唯一：同一任务重复建单返回已有账单，不重复预留（渠道切换的替换账单
   * 由调用方传入不同的键）。金额为 0 时仍建单，便于后台核对「这笔本该收多少」。
   */
  async reserveTaskBilling(params: {
    userId: string;
    taskId: string;
    idempotencyKey: string;
    draft: BillingDraft;
    promotionId?: string;
    chargeLimitMicrocredits?: bigint;
  }): Promise<{ order: BillingOrderRow; reserved: bigint; idempotentHit: boolean }> {
    const amount = params.draft.amountMicrocredits;
    const chargeLimitSet = params.chargeLimitMicrocredits !== undefined;
    const chargeLimit = params.chargeLimitMicrocredits ?? 0n;
    validateChargeLimit({ chargeLimitSet, chargeLimitMicrocredits: chargeLimit }, amount);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const reserved = await this.createReservedOrder(tx, {
          userId: params.userId,
          taskId: params.taskId,
          idempotencyKey: params.idempotencyKey,
          draft: params.draft,
          promotionId: params.promotionId,
          chargeLimitSet,
          chargeLimitMicrocredits: chargeLimit,
        });
        return { ...reserved, idempotentHit: false };
      });
    } catch (error) {
      if ((error as { code?: string })?.code === 'P2002') {
        const existing = await this.prisma.billingOrder.findUnique({
          where: {
            userId_idempotencyKey: { userId: params.userId, idempotencyKey: params.idempotencyKey },
          },
        });
        if (existing) {
          return {
            order: existing,
            reserved: existing.reservedAmountMicrocredits,
            idempotentHit: true,
          };
        }
      }
      throw error;
    }
  }

  /**
   * 线路切换时原子替换任务账单。
   *
   * 旧账单退款、新账单创建/预留、任务当前账单 CAS 与路由尝试建单必须同生共死：
   *   · 先退款旧单再预留新单，避免旧预授权占住余额导致「本可支付却被判余额不足」；
   *   · 任一步失败都回滚，旧账单继续有效，任务不会停在「已退款但没新账」；
   *   · CAS 同时校验任务租约与旧账单，防止两个执行者并发替换。
   *
   * `afterSwap` 由任务层提供，用于在同一事务内创建 RouteAttempt 并写线路快照。
   */
  async replaceTaskBilling(params: {
    userId: string;
    taskId: string;
    expectedBillingOrderId: string | null;
    expectedLeaseOwner: string;
    idempotencyKey: string;
    draft: BillingDraft;
    /** 限时免费等活动 id；换线后仍要留在新账单上供后续追溯 */
    promotionId?: string;
    chargeLimitMicrocredits: bigint;
    afterSwap?: (
      tx: Prisma.TransactionClient,
      result: { order: BillingOrderRow; reserved: bigint },
    ) => Promise<void>;
  }): Promise<{ order: BillingOrderRow; reserved: bigint }> {
    validateChargeLimit(
      { chargeLimitSet: true, chargeLimitMicrocredits: params.chargeLimitMicrocredits },
      params.draft.amountMicrocredits,
    );

    return this.prisma.$transaction(async (tx) => {
      const task = await tx.generationTask.findUnique({
        where: { id: params.taskId },
        select: { ownerId: true, billingOrderId: true, status: true, leaseOwner: true },
      });
      if (!task || task.ownerId !== params.userId) {
        throw new AppError(40400, '任务不存在或无权限', 404);
      }
      if (
        task.status !== 'running' ||
        task.leaseOwner !== params.expectedLeaseOwner ||
        task.billingOrderId !== params.expectedBillingOrderId
      ) {
        throw new AppError(40900, '任务租约或账单已变更，不能替换账单', 409);
      }

      if (params.expectedBillingOrderId) {
        const oldOrder = await tx.billingOrder.findUnique({
          where: { id: params.expectedBillingOrderId },
        });
        if (!oldOrder || oldOrder.userId !== params.userId || oldOrder.taskId !== params.taskId) {
          throw new AppError(40900, '旧账单不属于当前任务，不能替换', 409);
        }
        if (oldOrder.status !== 'reserved' && oldOrder.status !== 'running') {
          throw new AppError(40909, '旧账单状态已变更，不能替换', 409);
        }
        await this.refundInTransaction(tx, oldOrder, '线路切换，替换账单', 'route_switch');
      }

      const reserved = await this.createReservedOrder(tx, {
        userId: params.userId,
        taskId: params.taskId,
        idempotencyKey: params.idempotencyKey,
        draft: params.draft,
        promotionId: params.promotionId,
        chargeLimitSet: true,
        chargeLimitMicrocredits: params.chargeLimitMicrocredits,
      });

      const swapped = await tx.generationTask.updateMany({
        where: {
          id: params.taskId,
          ownerId: params.userId,
          status: 'running',
          leaseOwner: params.expectedLeaseOwner,
          billingOrderId: params.expectedBillingOrderId,
        },
        data: {
          billingOrderId: reserved.order.id,
          authorizedChargeMicrocredits: reserved.reserved,
          creditCost: Number((reserved.reserved + CREDIT_SCALE - 1n) / CREDIT_SCALE),
        },
      });
      if (swapped.count !== 1) {
        throw new AppError(40900, '任务租约或账单已变更，不能替换账单', 409);
      }

      await params.afterSwap?.(tx, reserved);
      return reserved;
    });
  }

  /**
   * 一次提交拆成 N 张图时，**在同一事务里**为每张建单并预留。
   *
   * 不能逐张调 `reserveTaskBilling`：第 3 张余额不足时，前 2 张的预授权已经落库，
   * 调用方只能再退一次账 —— 多一组「已退款但任务已被删」的死账单。整批放在一个
   * 事务里，余额不足就是整批不成立，任务与账单一起回滚。
   *
   * `tx` 可由调用方传入：任务准入要把「建任务 + 建账单 + 预留积分」放进**同一个**
   * 事务（见 `TaskAdmissionService`），避免中间崩溃留下「排队但无账单」的任务。
   */
  async reserveBatchBilling(params: {
    userId: string;
    /** 每张图一张账单；`idempotencyKey` 由调用方按任务 id 生成 */
    items: Array<{ taskId: string; idempotencyKey: string }>;
    draft: BillingDraft;
    promotionId?: string;
    /** 复用调用方的事务；不传则自开一个 */
    tx?: Prisma.TransactionClient;
  }): Promise<Array<{ taskId: string; order: BillingOrderRow; reserved: bigint }>> {
    const amount = params.draft.amountMicrocredits;
    const run = async (tx: Prisma.TransactionClient) => {
      const results: Array<{ taskId: string; order: BillingOrderRow; reserved: bigint }> = [];
      for (const item of params.items) {
        const reserved = await this.createReservedOrder(tx, {
          userId: params.userId,
          taskId: item.taskId,
          idempotencyKey: item.idempotencyKey,
          draft: params.draft,
          promotionId: params.promotionId,
          chargeLimitSet: false,
          chargeLimitMicrocredits: 0n,
        });
        results.push({ taskId: item.taskId, ...reserved });
      }
      return results;
    };
    return params.tx ? run(params.tx) : this.prisma.$transaction(run);
  }

  /**
   * 建单 + 预留的唯一实现（单张与整批共用）。
   *
   * 建单与预留必须在同一事务里：先建单后预留失败，会留下一张永远不会结算的账单。
   */
  private async createReservedOrder(
    tx: Prisma.TransactionClient,
    params: {
      userId: string;
      taskId: string;
      idempotencyKey: string;
      draft: BillingDraft;
      promotionId?: string;
      chargeLimitSet: boolean;
      chargeLimitMicrocredits: bigint;
    },
  ): Promise<{ order: BillingOrderRow; reserved: bigint }> {
    const amount = params.draft.amountMicrocredits;
    const order = await tx.billingOrder.create({
      data: {
        userId: params.userId,
        idempotencyKey: params.idempotencyKey,
        taskId: params.taskId,
        channelId: params.draft.channelId,
        channelModelId: params.draft.channelModelId,
        priceTierId: params.draft.priceTierId,
        priceTierVersion: params.draft.priceTierVersion,
        priceSelectorJson: params.draft.priceSelectorJson,
        model: params.draft.model,
        capability: params.draft.capability,
        scene: params.draft.scene,
        billingMode: params.draft.billingMode,
        priceVersion: params.draft.priceVersion,
        unitPriceMicrocredits: params.draft.unitPriceMicrocredits,
        multiplierBasisPoints: params.draft.multiplierBasisPoints,
        userGroup: params.draft.userGroup,
        priceCurrency: params.draft.priceCurrency,
        currencyRateMicrocredits: params.draft.currencyRateMicrocredits,
        quantity: params.draft.quantity,
        amountMicrocredits: amount,
        reservedAmountMicrocredits: amount,
        chargeLimitSet: params.chargeLimitSet,
        chargeLimitMicrocredits: params.chargeLimitMicrocredits,
        inputTokenPriceMicrocredits: params.draft.inputTokenPriceMicrocredits,
        outputTokenPriceMicrocredits: params.draft.outputTokenPriceMicrocredits,
        cachedTokenPriceMicrocredits: params.draft.cachedTokenPriceMicrocredits,
        inputTokens: params.draft.inputTokens,
        outputTokens: params.draft.outputTokens,
        cachedTokens: params.draft.cachedTokens,
        videoFormulaTokens: params.draft.videoFormulaTokens,
        // 成本快照：毛利核算的真实来源（不叠倍率、不参与售价）
        costConfigured: params.draft.costConfigured,
        costUnitPriceMicrocredits: params.draft.costUnitPriceMicrocredits,
        costInputTokenPriceMicrocredits: params.draft.costInputTokenPriceMicrocredits,
        costOutputTokenPriceMicrocredits: params.draft.costOutputTokenPriceMicrocredits,
        costCachedTokenPriceMicrocredits: params.draft.costCachedTokenPriceMicrocredits,
        costBillingMode: params.draft.costBillingMode,
        costQuantity: params.draft.costQuantity,
        costVideoFormulaTokens: params.draft.costVideoFormulaTokens,
        promotionId: params.promotionId ?? '',
        status: 'reserved',
      },
    });
    if (amount > 0n) {
      await this.wallet.reserve(tx, {
        userId: params.userId,
        amountMicrocredits: amount,
        billingOrderId: order.id,
        meta: {
          taskId: params.taskId,
          model: params.draft.model,
          channelId: params.draft.channelId,
          scene: params.draft.scene,
        },
      });
    }
    return { order, reserved: amount };
  }

  // ── 状态机 ────────────────────────────────────────────────────────

  /** 预留 → 运行中。CAS 失败说明账单已被其它执行者改过，必须停下而不是继续扣费 */
  async markRunning(billingOrderId: string): Promise<void> {
    if (!billingOrderId) return;
    const order = await this.prisma.billingOrder.findUnique({
      where: { id: billingOrderId },
      select: { status: true },
    });
    if (!order) throw new AppError(40400, '账单不存在', 404);
    if (order.status === 'running') return;
    const result = await this.prisma.billingOrder.updateMany({
      where: { id: billingOrderId, status: 'reserved' },
      data: { status: 'running', startedAt: new Date() },
    });
    if (result.count !== 1) throw new AppError(40909, '账单状态已变更，无法进入运行中', 409);
  }

  /** 记录上游请求 id：异步视频轮询与人工核对都依赖它 */
  async updateProviderRequestId(billingOrderId: string, providerRequestId: string): Promise<void> {
    const value = String(providerRequestId ?? '').trim();
    if (!billingOrderId || !value) return;
    await this.prisma.billingOrder.updateMany({
      where: { id: billingOrderId },
      data: { providerRequestId: value },
    });
  }

  /**
   * 结算：按实际用量扣费，差额退回。
   *
   * Token 账单读取同账单最新的成功调用 usage；上游没有 usage 时按能力决定：
   * 视频用提交时的公式快照（`video_formula`），文本直接失败转人工 ——
   * 文本预授权只是估算，不能拿它当最终账单。
   *
   * @param audioDurationMs 音频 / 视频处理任务的实测时长（毫秒）；按秒计费必传
   * @param deliveredQuantity 多图融合实际交付张数；用于按交付量结算并退回未交付部分
   */
  async settle(
    billingOrderId: string,
    options: {
      providerRequestId?: string;
      audioDurationMs?: number;
      deliveredQuantity?: number;
    } = {},
  ): Promise<BillingOrderRow> {
    if (!billingOrderId) throw new AppError(40001, '账单 id 不能为空', 400);

    // 结算依据必须在事务外可见：账户不一致导致回滚时，仍要把观察到的用量写回账单
    let observed: { usage: BillingUsage; source: string; actual: bigint } | null = null;
    try {
      return await this.prisma.$transaction(async (tx) => {
        const order = await tx.billingOrder.findUnique({ where: { id: billingOrderId } });
        if (!order) throw new AppError(40400, '账单不存在', 404);
        if (order.status === 'settled') return order;
        if (order.status === 'refunded') throw new AppError(40909, '已退款的账单不能重新结算', 409);
        return this.settleInTransaction(tx, order, options, (value) => {
          observed = value;
        });
      });
    } catch (error) {
      await this.persistObservedUsage(billingOrderId, observed);
      throw error;
    }
  }

  /**
   * 在调用方事务内完成结算。
   *
   * 终态写入使用 CAS：只有仍处于非终态的账单才能落 settled。并发结算、退款或
   * 自动清扫只要有一方先成功，其余事务会在钱包写入或终态 CAS 处失败并整体回滚。
   */
  private async settleInTransaction(
    tx: Prisma.TransactionClient,
    order: BillingOrderRow,
    options: { providerRequestId?: string; audioDurationMs?: number; deliveredQuantity?: number },
    onObserved: (value: { usage: BillingUsage; source: string; actual: bigint }) => void,
  ): Promise<BillingOrderRow> {
    const reserved =
      order.reservedAmountMicrocredits > 0n
        ? order.reservedAmountMicrocredits
        : order.amountMicrocredits;
    let actual = order.amountMicrocredits;
    let quantity = order.quantity;
    let usage: BillingUsage | null = null;
    let usageSource = order.usageSource;
    let note = '';

    /*
     * 限时免费：准入只把**金额**置 0，单价快照仍然保留（Token / 按秒计费需要
     * 它来算量）。若不在这里短路，Token 分支会按上游 usage、按秒分支会按实际
     * 时长重新算出正数金额，把一次已承诺的免费生成变成收费；换线账单还带
     * `chargeLimit=0`，会直接抛 40909 转人工。
     *
     * `promotionId` 目前只由命中 `limited_free` 的活动写入，且该路径金额恒为 0，
     * 所以「有活动 id + 金额与预留均为 0」足以判定为免费单。
     */
    const campaignFree =
      order.promotionId !== '' &&
      order.reservedAmountMicrocredits === 0n &&
      order.amountMicrocredits === 0n;
    if (campaignFree) {
      actual = 0n;
      note = '限时免费活动生效，按 0 积分结算';
    } else if (order.billingMode === 'token' && !zeroPricedTokenOrder(order)) {
      const observedUsage = await this.tokenSettlementUsage(tx, order);
      if (!observedUsage) throw new AppError(40909, '上游用量不可用，无法结算 Token 账单', 409);
      usage = observedUsage.usage;
      usageSource = observedUsage.source;
      actual = this.tokenUsageAmount(order, usage);
      onObserved({ usage, source: usageSource, actual });
      if (chargeLimitApplies(order) && actual > order.chargeLimitMicrocredits) {
        actual = order.chargeLimitMicrocredits;
        note = 'Token 实际用量超过授权上限，已按上限结算';
      } else if (actual > reserved) {
        note = 'Token 实际用量超过预授权，已补扣差额';
      }
      if (usageSource === USAGE_SOURCE_VIDEO_FORMULA) {
        note = note
          ? `按提交时的视频 Token 公式快照结算；${note}`
          : '按提交时的视频 Token 公式快照结算';
      }
    } else if (
      order.billingMode === 'per_second' &&
      (order.capability === 'audio' ||
        (order.capability === 'video' && options.audioDurationMs !== undefined))
    ) {
      const mediaLabel = order.capability === 'video' ? '视频' : '音频';
      const durationMs = options.audioDurationMs ?? 0;
      if (!Number.isFinite(durationMs) || durationMs <= 0) {
        throw new AppError(40909, `${mediaLabel}实际时长不可用，无法按秒结算`, 409);
      }
      quantity = BigInt(Math.ceil(durationMs / 1000));
      actual = creditAmount(order.unitPriceMicrocredits, quantity, order.multiplierBasisPoints);
      if (chargeLimitApplies(order) && actual > order.chargeLimitMicrocredits) {
        throw new AppError(40909, `${mediaLabel}实际费用超过本次授权上限，需人工核对`, 409);
      }
      note = `${mediaLabel}按实际输出时长结算`;
    } else if (order.capability === 'multi_fusion' && options.deliveredQuantity !== undefined) {
      const requested = Number(order.quantity);
      const delivered = Math.trunc(options.deliveredQuantity);
      if (!Number.isSafeInteger(requested) || requested <= 0) {
        throw new AppError(40909, '多图融合请求张数无效，无法结算', 409);
      }
      if (!Number.isFinite(delivered) || delivered <= 0) {
        throw new AppError(40909, '多图融合没有可用交付，无法按交付量结算', 409);
      }
      quantity = BigInt(Math.min(requested, delivered));
      // 预留金额已按「请求张数 × 画质倍率」缩放，按实际张数占比结算即可；
      // 向上取整保证至少一张的金额不会被浮点/截断吞掉。
      actual = (order.amountMicrocredits * quantity + order.quantity - 1n) / order.quantity;
      validateChargeLimit(order, actual);
      if (quantity < order.quantity) {
        note = `按实际交付 ${quantity.toString()}/${order.quantity.toString()} 张结算`;
      }
    } else {
      validateChargeLimit(order, order.amountMicrocredits);
    }

    await this.wallet.settle(tx, {
      userId: order.userId,
      billingOrderId: order.id,
      reservedMicrocredits: reserved,
      actualMicrocredits: actual,
      note,
      meta: {
        taskId: order.taskId,
        model: order.model,
        channelId: order.channelId,
        scene: order.scene,
      },
    });

    const refund = reserved > actual ? reserved - actual : 0n;
    const updated = await tx.billingOrder.updateMany({
      where: { id: order.id, status: { in: ['reserved', 'running', 'uncertain'] } },
      data: {
        status: 'settled',
        settledAt: new Date(),
        quantity,
        actualAmountMicrocredits: actual,
        refundedAmountMicrocredits: refund,
        inputTokens: usage?.inputTokens ?? order.inputTokens,
        outputTokens: usage?.outputTokens ?? order.outputTokens,
        cachedTokens: usage?.cachedTokens ?? order.cachedTokens,
        usageAvailable: usage !== null && usageSource === USAGE_SOURCE_PROVIDER,
        usageSource,
        providerRequestId: options.providerRequestId || order.providerRequestId,
      },
    });
    if (updated.count !== 1) throw new AppError(40909, '账单状态已变更，无法结算', 409);
    const result = await tx.billingOrder.findUnique({ where: { id: order.id } });
    if (!result) throw new AppError(40400, '账单不存在', 404);
    return result;
  }

  /** 事务已回滚时保留观察到的结算依据，便于管理员核对；不影响原始错误上抛 */
  private async persistObservedUsage(
    billingOrderId: string,
    observed: { usage: BillingUsage; source: string; actual: bigint } | null,
  ): Promise<void> {
    if (!observed) return;
    await this.prisma.billingOrder
      .updateMany({
        where: { id: billingOrderId, status: { notIn: ['settled', 'refunded'] } },
        data: {
          actualAmountMicrocredits: observed.actual,
          inputTokens: observed.usage.inputTokens,
          outputTokens: observed.usage.outputTokens,
          cachedTokens: observed.usage.cachedTokens,
          usageAvailable: observed.source === USAGE_SOURCE_PROVIDER,
          usageSource: observed.source,
        },
      })
      .catch(() => undefined);
  }

  /**
   * 退款：未结算账单把冻结金额全额退回。
   * 已结算账单只能人工退款（`resolve` 之前先核对）—— 自动退款会与结算流水冲突。
   *
   * `reason` 决定这笔退款在财务口径里的归类：
   *   · `route_switch` —— 线路切换的内部重预留，钱没离开平台，
   *     **不计入「已退」**（否则一次 9 分换 4 分会显示净收入 −5）；
   *   · 其余（失败 / 人工 / 超时）—— 真实退款，计入「已退」。
   *
   * `resolution` 供自动退款扫描器把「处理人 / 处理说明」与退款写进同一事务。
   * 分开两步写会出现「钱已退、账单仍显示未核对」，进程崩在中间时无法自愈；
   * 这里复用已有 interactive transaction，不再在外层包一层（嵌套事务在 SQLite
   * driver adapter 下会锁等待）。
   */
  async refund(
    billingOrderId: string,
    errorText = '',
    reason: RefundReason = 'failure',
    resolution?: { resolvedBy: string; resolutionNote: string },
  ): Promise<BillingOrderRow> {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.billingOrder.findUnique({ where: { id: billingOrderId } });
      if (!order) throw new AppError(40400, '账单不存在', 404);
      if (order.status === 'settled') throw new AppError(40909, '已结算账单需人工退款', 409);
      // 已退款账单不再动钱包，但仍要补写核对信息：扫描器原先就是先 refund()
      // 再单独 updateMany()，对历史「已退但未核对」的行同样会补标记。
      const refunded =
        order.status === 'refunded'
          ? order
          : await this.refundInTransaction(tx, order, errorText, reason);
      if (resolution) {
        await tx.billingOrder.updateMany({
          where: { id: order.id, resolvedBy: '' },
          data: { resolvedBy: resolution.resolvedBy, resolutionNote: resolution.resolutionNote },
        });
      }
      return refunded;
    });
  }

  /**
   * 在调用方事务内完成退款；终态 CAS 防止同一张账单被并发退两次。
   *
   * 退款金额取 **`reservedAmountMicrocredits`**（真正冻结的量），而不是
   * `amountMicrocredits`（建单时的预授权快照）。两者目前恒等，但一旦引入
   * 授权上限截断、部分预授权之类的改动就会分叉 —— 那时按 `amount` 退款会
   * 与钱包里实际冻结的数不一致，`wallet.refund` 的 CAS 直接失败，
   * 表现为「点了退款但退不掉」。取冻结量才是语义正确的口径。
   */
  private async refundInTransaction(
    tx: Prisma.TransactionClient,
    order: BillingOrderRow,
    errorText: string,
    reason: RefundReason,
  ): Promise<BillingOrderRow> {
    const amount =
      order.reservedAmountMicrocredits > 0n
        ? order.reservedAmountMicrocredits
        : order.amountMicrocredits;
    if (amount > 0n) {
      await this.wallet.refund(tx, {
        userId: order.userId,
        billingOrderId: order.id,
        amountMicrocredits: amount,
        note: errorText || '任务失败退款',
        meta: {
          taskId: order.taskId,
          model: order.model,
          channelId: order.channelId,
          scene: order.scene,
        },
      });
    }
    const updated = await tx.billingOrder.updateMany({
      where: { id: order.id, status: { in: ['reserved', 'running', 'uncertain'] } },
      data: {
        status: 'refunded',
        refundedAt: new Date(),
        refundedAmountMicrocredits: amount,
        errorText,
        refundReason: reason,
      },
    });
    if (updated.count !== 1) throw new AppError(40909, '账单状态已变更，无法退款', 409);
    const result = await tx.billingOrder.findUnique({ where: { id: order.id } });
    if (!result) throw new AppError(40400, '账单不存在', 404);
    return result;
  }

  /** 结果不明：保留冻结积分，等人工核对。绝不自动结算或退款 */
  async markUncertain(billingOrderId: string, errorText = ''): Promise<void> {
    if (!billingOrderId) return;
    await this.prisma.billingOrder.updateMany({
      where: { id: billingOrderId, status: { in: ['reserved', 'running'] } },
      data: { status: 'uncertain', errorText },
    });
  }

  /**
   * 人工核对：`settle` 按现有用量结算，`refund` 全额退回。
   * 是否可核对由 `isBillingOrderReviewable` 统一判定，终态永不可改写。
   */
  async resolve(
    billingOrderId: string,
    action: 'settle' | 'refund',
    actorUserId: string,
    note: string,
    options: { reviewBatchId?: string } = {},
  ): Promise<BillingOrderRow> {
    const reason = String(note ?? '').trim();
    if (!reason) throw new AppError(40001, '请填写核对依据', 400);
    if (action !== 'settle' && action !== 'refund')
      throw new AppError(40001, '请选择结算或退款', 400);

    let observed: { usage: BillingUsage; source: string; actual: bigint } | null = null;
    try {
      // 资金变动、终态和核对人必须同生共死；终态 CAS 保证并发处置只有一方成功。
      return await this.prisma.$transaction(async (tx) => {
        const order = await tx.billingOrder.findUnique({ where: { id: billingOrderId } });
        if (!order) throw new AppError(40400, '账单不存在', 404);
        const task = order.taskId
          ? await tx.generationTask.findUnique({
              where: { id: order.taskId },
              select: {
                status: true,
                outputAssetId: true,
                pendingResult: true,
                mediaRecoveryError: true,
              },
            })
          : null;
        if (!isBillingOrderReviewable(order, task, Date.now(), action)) {
          throw new AppError(
            40909,
            action === 'refund'
              ? '当前账单不满足退款条件：已交付作品不可退款，或任务仍可执行 / 正在补交付；仅结果不明、超时运行，或预授权对应的任务已失败/取消时才可退款'
              : '当前账单不满足结算条件：任务仍在补交付，或账单已是终态',
            409,
          );
        }

        const updated =
          action === 'settle'
            ? await this.settleInTransaction(
                tx,
                order,
                { providerRequestId: order.providerRequestId },
                (value) => {
                  observed = value;
                },
              )
            : await this.refundInTransaction(tx, order, reason, 'manual');

        const marked = await tx.billingOrder.updateMany({
          where: { id: updated.id, status: updated.status },
          data: {
            resolvedBy: actorUserId,
            resolutionNote: reason,
            reviewBatchId: String(options.reviewBatchId ?? '').trim(),
          },
        });
        if (marked.count !== 1) throw new AppError(40909, '账单状态已变更，请刷新后重试', 409);
        const result = await tx.billingOrder.findUnique({ where: { id: updated.id } });
        if (!result) throw new AppError(40400, '账单不存在', 404);
        return result;
      });
    } catch (error) {
      await this.persistObservedUsage(billingOrderId, observed);
      throw error;
    }
  }

  // ── 查询 ──────────────────────────────────────────────────────────

  async get(billingOrderId: string): Promise<BillingOrderRow> {
    const order = await this.prisma.billingOrder.findUnique({ where: { id: billingOrderId } });
    if (!order) throw new AppError(40400, '账单不存在', 404);
    return order;
  }

  async orderOfTask(taskId: string): Promise<BillingOrderRow | null> {
    if (!taskId) return null;
    return this.prisma.billingOrder.findFirst({
      where: { taskId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * 上游是否可能已经产生结果 —— 决定失败时退款还是转人工。
   *
   * 超时、连接中断、以及「任务里已有成功的可计费调用」都说明上游可能已经干活，
   * 自动退款等于平台白付一次调用费。
   */
  async failureRequiresReview(
    billingOrderId: string,
    taskId: string,
    error?: unknown,
  ): Promise<boolean> {
    if (!billingOrderId) return false;
    if (billingFailureUncertain(error)) return true;
    const order = await this.prisma.billingOrder.findUnique({
      where: { id: billingOrderId },
      select: { status: true },
    });
    if (!order || order.status === 'uncertain') return true;
    const success = await this.prisma.apiCallLog.count({
      where: { taskId, status: 'success', billable: true },
    });
    return success > 0;
  }

  // ── 内部 ─────────────────────────────────────────────────────────

  /** Token 结算用量：上游 usage 优先；视频缺 usage 时退回提交时的公式快照 */
  private async tokenSettlementUsage(
    db: Prisma.TransactionClient,
    order: BillingOrderRow,
  ): Promise<{ usage: BillingUsage; source: string } | null> {
    const log = await db.apiCallLog.findFirst({
      where: { billingOrderId: order.id, status: 'success', usageAvailable: true },
      orderBy: { createdAt: 'desc' },
    });
    if (order.capability !== 'video') {
      if (!log) return null;
      return {
        usage: {
          inputTokens: log.inputTokens,
          outputTokens: log.outputTokens,
          cachedTokens: log.cachedTokens,
        },
        source: USAGE_SOURCE_PROVIDER,
      };
    }
    // 视频 Token 总用量已由供应商 completion_tokens 表达，不再叠加输入与缓存
    if (log && log.outputTokens > 0n) {
      return {
        usage: { inputTokens: 0n, outputTokens: log.outputTokens, cachedTokens: 0n },
        source: USAGE_SOURCE_PROVIDER,
      };
    }
    // 预授权 Quantity 含余量，不能当最终用量；只认提交时明确记录的公式快照
    if (order.videoFormulaTokens > 0n) {
      return {
        usage: { inputTokens: 0n, outputTokens: order.videoFormulaTokens, cachedTokens: 0n },
        source: USAGE_SOURCE_VIDEO_FORMULA,
      };
    }
    return null;
  }

  /** Token 金额：文本按输入（扣缓存）+ 缓存 + 输出分别计价；视频只算输出 */
  private tokenUsageAmount(order: BillingOrderRow, usage: BillingUsage): bigint {
    if (usage.inputTokens < 0n || usage.outputTokens < 0n || usage.cachedTokens < 0n) {
      throw new AppError(40909, 'Token 用量无效，无法结算', 409);
    }
    if (order.capability === 'video' && usage.outputTokens <= 0n) {
      throw new AppError(40909, '视频 Token 用量不可用，无法结算', 409);
    }
    if (order.capability === 'video') {
      return tokenAmount(
        {
          inputTokens: 0,
          outputTokens: Number(usage.outputTokens),
          cachedTokens: 0,
          inputTokenPriceMicrocredits: 0n,
          outputTokenPriceMicrocredits: order.outputTokenPriceMicrocredits,
          cachedTokenPriceMicrocredits: 0n,
        },
        order.multiplierBasisPoints,
      );
    }
    const inputOnly =
      usage.inputTokens > usage.cachedTokens ? usage.inputTokens - usage.cachedTokens : 0n;
    return tokenAmount(
      {
        inputTokens: Number(inputOnly),
        outputTokens: Number(usage.outputTokens),
        cachedTokens: Number(usage.cachedTokens),
        inputTokenPriceMicrocredits: order.inputTokenPriceMicrocredits,
        outputTokenPriceMicrocredits: order.outputTokenPriceMicrocredits,
        cachedTokenPriceMicrocredits: order.cachedTokenPriceMicrocredits,
      },
      order.multiplierBasisPoints,
    );
  }
}

function truncate(value: string, max: number): string {
  return [...value].slice(0, max).join('');
}
