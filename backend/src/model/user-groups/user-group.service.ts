/**
 * 用户分组：渠道可见性、价格倍率与货币兑换比例。
 *
 * 移植自 open-ai-canvas `internal/app/user_groups.go`。
 *
 * 分组解决两个真实问题：
 *   1. **不同客户看到不同模型集合** —— 代理/企业客户只能走约定渠道；
 *   2. **同一份价格按客户倍率折算** —— 目录展示价与账单必须用同一组因子，
 *      否则「前台看到 10 积分、扣了 12 积分」就是资损级投诉。
 *
 * 本仓 `User` 表没有分组列：分组由「会员套餐 → `MembershipPlan.userGroupCode`」
 * 映射得到（`docs/channel-model-design.md` §14.2）。无有效会员时落默认分组。
 */

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { AppError } from '../../common/app.exception';
import { PrismaService } from '../../prisma/prisma.service';
import { CatalogVersionService } from '../infra/catalog-version.service';
import {
  CREDIT_SCALE,
  combineMultiplierBasisPoints,
  convertCurrencyPrice,
} from '../infra/microcredits';
import { badRequest } from '../domain/json';

/** 默认分组：计费基线，启动时补齐 */
export const DEFAULT_USER_GROUP_CODE = 'default';
const DEFAULT_POINTS_PER_USD = 7_000_000n;
const DEFAULT_POINTS_PER_CNY = 1_000_000n;

/** 分组快照 TTL：与路由目录保持一致，避免两套缓存错位 */
const GROUP_CACHE_TTL_MS = 30_000;
const USER_GROUP_CACHE_TTL_MS = 30_000;

export interface UserGroupModelOverride {
  modelKey: string;
  ratioBasisPoints?: number;
  pointsPerUsd?: number;
  pointsPerCny?: number;
}

/** 一次下单使用的分组价格因子 */
export interface GroupPricing {
  groupCode: string;
  currency: string;
  /** 1 单位该货币折合多少微积分；积分计价时等于 1e6 */
  rateMicrocredits: bigint;
  /** 分组倍率 × 模型覆盖倍率（连乘向上取整） */
  multiplierBasisPoints: bigint;
}

export interface ResolvedGroup {
  id: string;
  code: string;
  name: string;
  badgeLabel: string;
  badgeStyle: string;
  ratioBasisPoints: number;
  pointsPerUsd: bigint;
  pointsPerCny: bigint;
  allChannels: boolean;
  channels: Set<string>;
  overrides: Map<string, UserGroupModelOverride>;
}

/**
 * 请求级分组上下文。
 * `bypassVisibility` 只放开渠道可见性（管理员与内部探测），价格仍按分组算。
 */
export class UserGroupAccess {
  constructor(
    readonly group: ResolvedGroup,
    private readonly bypassVisibility = false,
  ) {}

  allowsChannel(channelId: string): boolean {
    if (this.bypassVisibility || this.group.allChannels) return true;
    return this.group.channels.has(String(channelId ?? '').trim());
  }

  requireChannel(channelId: string): void {
    if (this.allowsChannel(channelId)) return;
    throw badRequest('当前账号分组无权使用该模型，请刷新后重新选择');
  }

  get groupCode(): string {
    return this.group.code;
  }

  /**
   * 取该分组对某模型的价格因子。
   * `modelKeys` 按优先级匹配覆盖项（前台模型 code 优先于渠道模型 key）。
   */
  pricing(currency: string, modelKeys: string[] = []): GroupPricing {
    const normalized = normalizePriceCurrency(currency);
    let multiplier = BigInt(this.group.ratioBasisPoints);
    let rate = CREDIT_SCALE;
    let override: UserGroupModelOverride | undefined;
    for (const key of modelKeys) {
      const trimmed = String(key ?? '').trim();
      if (trimmed === '') continue;
      const found = this.group.overrides.get(trimmed);
      if (found) {
        override = found;
        break;
      }
    }
    if (override && (override.ratioBasisPoints ?? 0) > 0) {
      multiplier = combineMultiplierBasisPoints(this.group.ratioBasisPoints, override.ratioBasisPoints);
    }
    if (normalized === 'USD') {
      rate = (override?.pointsPerUsd ?? 0) > 0 ? BigInt(override!.pointsPerUsd!) : this.group.pointsPerUsd;
    } else if (normalized === 'CNY') {
      rate = (override?.pointsPerCny ?? 0) > 0 ? BigInt(override!.pointsPerCny!) : this.group.pointsPerCny;
    }
    if (rate <= 0n) {
      throw badRequest(`当前账号分组尚未配置 ${normalized} 兑换积分比例`);
    }
    if (multiplier <= 0n) throw badRequest('当前账号分组倍率无效');
    return { groupCode: this.group.code, currency: normalized, rateMicrocredits: rate, multiplierBasisPoints: multiplier };
  }

  /** 把「百万分之一货币单位」的价格换算成微积分（积分计价原样返回） */
  convertPrice(price: number, pricing: GroupPricing): bigint {
    return convertCurrencyPrice(price, pricing.rateMicrocredits);
  }
}

/** 计价货币归一：空 / CREDITS 视为积分 */
export function normalizePriceCurrency(value: string | null | undefined): string {
  const text = String(value ?? '').trim().toUpperCase();
  if (text === '' || text === 'CREDITS') return 'credits';
  if (text === 'USD' || text === 'CNY') return text;
  throw badRequest('计价货币只支持积分、USD 或 CNY');
}

/** 分组编码归一：空串落默认分组 */
export function normalizeUserGroupCode(code: string | null | undefined): string {
  const value = String(code ?? '').trim().toLowerCase();
  return value === '' ? DEFAULT_USER_GROUP_CODE : value;
}

@Injectable()
export class UserGroupService implements OnModuleInit {
  private readonly log = new Logger(UserGroupService.name);
  private snapshot: { byCode: Map<string, ResolvedGroup>; loadedAt: number } | null = null;
  private userGroupCodes = new Map<string, { code: string; loadedAt: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly catalogVersion: CatalogVersionService,
  ) {}

  onModuleInit(): void {
    this.catalogVersion.onChange(() => this.invalidate());
  }

  /**
   * 启动期补齐默认分组。默认分组开放全部系统渠道、倍率 1.0，
   * 保证升级后「目录内容不变」—— 新引入的分组不能悄悄缩小老用户的可选范围。
   */
  async ensureDefaultGroup(): Promise<void> {
    const existing = await this.prisma.userGroup.findFirst({
      where: { activeKey: DEFAULT_USER_GROUP_CODE, deletedAt: null },
      select: { id: true },
    });
    if (existing) return;
    try {
      await this.prisma.userGroup.create({
        data: {
          code: DEFAULT_USER_GROUP_CODE,
          activeKey: DEFAULT_USER_GROUP_CODE,
          name: '默认分组',
          ratioBasisPoints: 10_000,
          pointsPerUsd: DEFAULT_POINTS_PER_USD,
          pointsPerCny: DEFAULT_POINTS_PER_CNY,
          allChannels: true,
          modelOverridesJson: '[]',
        },
      });
    } catch (error) {
      // 并发启动（多进程/多次初始化）时唯一键冲突是正常结果，不算失败
      const retried = await this.prisma.userGroup.findFirst({
        where: { activeKey: DEFAULT_USER_GROUP_CODE, deletedAt: null },
        select: { id: true },
      });
      if (!retried) throw error;
    }
    this.invalidate();
  }

  /** 后台写入分组后必须调用：清空进程内缓存 */
  invalidate(): void {
    this.snapshot = null;
    this.userGroupCodes.clear();
  }

  /** 登录用户的分组上下文；匿名用户返回默认分组（目录公开浏览） */
  async accessForUser(userId: string | null | undefined): Promise<UserGroupAccess> {
    const id = String(userId ?? '').trim();
    if (id === '') return this.systemAccess();
    const code = await this.groupCodeForUser(id);
    return new UserGroupAccess(await this.resolvedGroup(code));
  }

  /** 内部能力探测：放开渠道可见性，价格按默认分组 */
  async systemAccess(): Promise<UserGroupAccess> {
    return new UserGroupAccess(await this.resolvedGroup(DEFAULT_USER_GROUP_CODE), true);
  }

  /** 用户 → 分组编码（会员套餐映射，无有效会员落默认分组） */
  async groupCodeForUser(userId: string): Promise<string> {
    const cached = this.userGroupCodes.get(userId);
    const now = Date.now();
    if (cached && now - cached.loadedAt < USER_GROUP_CACHE_TTL_MS) return cached.code;
    const at = new Date(now);
    const [activePeriod, hasPeriodSnapshot, legacyMembership] = await Promise.all([
      // 已付订单周期是会员权益的权威来源。直接读 Membership.plan 会把已经
      // 提前购买、尚未开始的未来套餐算成当前分组。
      this.prisma.order.findFirst({
        where: {
          userId,
          membershipPlanId: { not: null },
          membershipAppliedAt: { not: null },
          membershipPeriodStartAt: { lte: at },
          membershipPeriodEndAt: { gt: at },
          membershipPeriodRevokedAt: null,
          status: { in: ['paid', 'partial_refunded'] },
        },
        orderBy: { membershipPeriodStartAt: 'desc' },
        select: {
          membershipUserGroupCodeSnapshot: true,
          membershipPlan: { select: { userGroupCode: true } },
        },
      }),
      this.prisma.order.findFirst({
        where: {
          userId,
          membershipPlanId: { not: null },
          membershipAppliedAt: { not: null },
          membershipPeriodEndAt: { not: null },
        },
        select: { id: true },
      }),
      this.prisma.membership.findFirst({
        where: {
          userId,
          status: { in: ['active', 'grace', 'cancelled'] },
          expiresAt: { gt: at },
        },
        orderBy: [{ expiresAt: 'desc' }],
        select: { plan: { select: { userGroupCode: true } } },
      }),
    ]);
    const code = normalizeUserGroupCode(
      activePeriod?.membershipUserGroupCodeSnapshot ??
        // 历史订单没有分组快照时才回退当前套餐映射。
        activePeriod?.membershipPlan?.userGroupCode ??
        // 已有订单快照但当前处于周期空档/仅未来周期时落默认分组，不能用
        // Membership 的未来套餐投影兜底。
        (hasPeriodSnapshot ? '' : legacyMembership?.plan?.userGroupCode),
    );
    this.userGroupCodes.set(userId, { code, loadedAt: now });
    return code;
  }

  /** 取分组；默认分组缺失时即时补齐（新库或被并发清空的窗口） */
  async resolvedGroup(code: string): Promise<ResolvedGroup> {
    const normalized = normalizeUserGroupCode(code);
    let groups = await this.groups();
    if (!groups.has(normalized) && normalized === DEFAULT_USER_GROUP_CODE) {
      await this.ensureDefaultGroup();
      groups = await this.groups();
    }
    const group = groups.get(normalized);
    if (!group) {
      // 分组被删除前必须清空用户，走到这里说明配置损坏：失败关闭，不回退默认分组
      throw new AppError(40301, '当前账号分组配置无效，请联系管理员', 403);
    }
    return group;
  }

  async groups(): Promise<Map<string, ResolvedGroup>> {
    const now = Date.now();
    if (this.snapshot && now - this.snapshot.loadedAt < GROUP_CACHE_TTL_MS) return this.snapshot.byCode;
    const rows = await this.prisma.userGroup.findMany({ where: { deletedAt: null } });
    const links = await this.prisma.userGroupChannel.findMany({
      where: { groupId: { in: rows.map((row) => row.id) } },
    });
    const byCode = new Map<string, ResolvedGroup>();
    for (const row of rows) {
      const code = normalizeUserGroupCode(row.code);
      byCode.set(code, {
        id: row.id,
        code,
        name: row.name,
        badgeLabel: row.badgeLabel,
        badgeStyle: row.badgeStyle,
        ratioBasisPoints: row.ratioBasisPoints,
        pointsPerUsd: row.pointsPerUsd,
        pointsPerCny: row.pointsPerCny,
        allChannels: row.allChannels,
        channels: new Set(links.filter((link) => link.groupId === row.id).map((link) => link.channelId)),
        overrides: decodeOverrides(row.modelOverridesJson),
      });
    }
    this.snapshot = { byCode, loadedAt: now };
    return byCode;
  }
}

/** 解析模型级覆盖项；非法条目丢弃并保留其余（配置损坏不应让全站不可用） */
function decodeOverrides(raw: string): Map<string, UserGroupModelOverride> {
  const result = new Map<string, UserGroupModelOverride>();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw || '[]');
  } catch {
    return result;
  }
  if (!Array.isArray(parsed)) return result;
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const modelKey = String(row.modelKey ?? '').trim();
    if (modelKey === '') continue;
    result.set(modelKey, {
      modelKey,
      ratioBasisPoints: positiveNumber(row.ratioBasisPoints),
      pointsPerUsd: positiveNumber(row.pointsPerUsd ?? row.pointsPerUsdMicrocredits),
      pointsPerCny: positiveNumber(row.pointsPerCny ?? row.pointsPerCnyMicrocredits),
    });
  }
  return result;
}

function positiveNumber(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : undefined;
}
