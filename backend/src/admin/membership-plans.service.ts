import { Injectable } from '@nestjs/common';
import { AppError } from '../common/app.exception';
import {
  MembershipService,
  buildPerkLabels,
  parsePerks,
  type Perks,
} from '../membership/membership.service';
import { PrismaService } from '../prisma/prisma.service';

/** 权益输入。与 C 端 `parsePerks` 的字段一致，避免后台写进 C 端读不懂的 JSON */
export interface PlanPerksInput {
  fastChannel?: boolean;
  /** 同时进行中任务上限。0 = 不限 */
  maxConcurrent?: number;
  /** 加油包折扣万分比。10000 = 无折扣 */
  addonDiscountBps?: number;
}

export interface CreateMembershipPlanInput {
  code: string;
  name: string;
  description?: string;
  /** 整数分。会员订阅价 */
  priceCents: number;
  /** 周期天数。0 = 永久（仅 free 套餐可用） */
  durationDays: number;
  monthlyCredits: number;
  perks?: PlanPerksInput;
  status?: 'active' | 'offline';
  sortOrder?: number;
  /**
   * 会员等级映射的用户分组。
   *
   * 分组决定该等级用户可见的渠道与价格倍率（`docs/model-architecture.md` §6）。
   * 留空 = 落 `default` 分组；运营不配的话分组倍率永不生效，界面却看不出异常。
   */
  userGroupCode?: string;
}

/** 更新入参。`code` 不可改；上下架走独立动作 */
export type UpdateMembershipPlanInput = Partial<
  Omit<CreateMembershipPlanInput, 'code' | 'status'>
>;

export interface SetPlanStatusInput {
  status: 'active' | 'offline';
}

/** 归一化权益：缺省字段补齐，避免库里出现半份 JSON */
function normalizePerks(input?: PlanPerksInput): Perks {
  const base = parsePerks(JSON.stringify(input ?? {}));
  return {
    fastChannel: input?.fastChannel ?? base.fastChannel,
    maxConcurrent: input?.maxConcurrent ?? base.maxConcurrent,
    addonDiscountBps: input?.addonDiscountBps ?? base.addonDiscountBps,
  };
}

function planView(plan: {
  id: string;
  code: string;
  name: string;
  description: string;
  priceCents: number;
  durationDays: number;
  monthlyCredits: number;
  perks: string;
  status: string;
  sortOrder: number;
  userGroupCode: string;
  createdAt: Date;
  updatedAt: Date;
  _count?: { memberships: number; orders: number };
}) {
  const perks = parsePerks(plan.perks);
  return {
    id: plan.id,
    code: plan.code,
    name: plan.name,
    description: plan.description,
    priceCents: plan.priceCents,
    durationDays: plan.durationDays,
    monthlyCredits: plan.monthlyCredits,
    perks,
    /** 权益文案由后端生成，后台与 C 端不会各写一套 */
    perkLabels: buildPerkLabels(perks, plan.monthlyCredits),
    status: plan.status,
    sortOrder: plan.sortOrder,
    /** 会员等级映射的用户分组；空串 = 落 `default` 分组 */
    userGroupCode: plan.userGroupCode ?? '',
    memberCount: plan._count?.memberships ?? 0,
    orderCount: plan._count?.orders ?? 0,
    createdAt: plan.createdAt.toISOString(),
    updatedAt: plan.updatedAt.toISOString(),
  };
}

/** 会员套餐管理：C 端价目表的唯一写入入口 */
@Injectable()
export class AdminMembershipPlansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly membership: MembershipService,
  ) {}

  async list() {
    const plans = await this.prisma.membershipPlan.findMany({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      include: { _count: { select: { memberships: true, orders: true } } },
    });
    return { items: plans.map(planView) };
  }

  async create(input: CreateMembershipPlanInput) {
    if (input.code === 'free') {
      throw new AppError(40001, 'free 套餐由系统内置，不能重复创建', 400);
    }
    if (input.durationDays === 0) {
      throw new AppError(40001, '可购买的套餐周期必须大于 0 天', 400);
    }
    const perks = normalizePerks(input.perks);
    const exists = await this.prisma.membershipPlan.findUnique({
      where: { code: input.code },
    });
    if (exists) throw new AppError(40901, `套餐编码 ${input.code} 已存在`, 409);
    const userGroupCode = await this.resolveUserGroupCode(input.userGroupCode);

    const plan = await this.prisma.membershipPlan.create({
      data: {
        code: input.code,
        name: input.name,
        description: input.description ?? '',
        priceCents: input.priceCents,
        durationDays: input.durationDays,
        monthlyCredits: input.monthlyCredits,
        perks: JSON.stringify(perks),
        // 默认下架：运营建完套餐应先核对价目与权益，再手动上架
        status: input.status ?? 'offline',
        sortOrder: input.sortOrder ?? 0,
        userGroupCode,
      },
      include: { _count: { select: { memberships: true, orders: true } } },
    });
    return planView(plan);
  }

  async update(id: string, input: UpdateMembershipPlanInput) {
    const existing = await this.prisma.membershipPlan.findUnique({
      where: { id },
    });
    if (!existing) throw new AppError(40400, '会员套餐不存在', 404);

    if (existing.code === 'free') {
      if (input.priceCents !== undefined && input.priceCents !== 0) {
        throw new AppError(40001, 'free 套餐必须保持 0 元', 400);
      }
      if (input.durationDays !== undefined && input.durationDays !== 0) {
        throw new AppError(40001, 'free 套餐必须是永久有效', 400);
      }
    } else if (input.durationDays === 0) {
      throw new AppError(40001, '可购买的套餐周期必须大于 0 天', 400);
    }

    const data: Record<string, unknown> = {};
    for (const key of [
      'name',
      'description',
      'priceCents',
      'durationDays',
      'monthlyCredits',
      'sortOrder',
    ] as const) {
      if (input[key] !== undefined) data[key] = input[key];
    }
    if (input.perks !== undefined) {
      // 修改权益只影响新订单；存量会员用 Membership.perksSnapshot，不会被追溯改价
      data.perks = JSON.stringify(normalizePerks(input.perks));
    }
    if (input.userGroupCode !== undefined) {
      data.userGroupCode = await this.resolveUserGroupCode(input.userGroupCode);
    }

    const plan = await this.prisma.membershipPlan.update({
      where: { id },
      data,
      include: { _count: { select: { memberships: true, orders: true } } },
    });
    // 历史订单没有分组快照时仍回退当前套餐映射；后台改动后必须立刻失效
    // 用户分组缓存，否则最多 30 秒内新旧订单可能读取到不一致映射。
    if (input.userGroupCode !== undefined) {
      await this.membership.invalidateUserGroupCatalog();
    }
    return planView(plan);
  }

  /**
   * 校验并归一会员等级要映射的用户分组。
   *
   * 空串 = 不映射 = 落 `default` 分组（合法的兜底）。
   * 非空时**必须存在**：写一个不存在的分组编码不会报错，只会让所有该等级的用户
   * 在取分组时静默回落默认组 —— 运营以为配了专属分组，实际倍率与渠道可见性
   * 一点都没生效。故在这里显式拒绝。
   */
  private async resolveUserGroupCode(raw: string | undefined): Promise<string> {
    const code = String(raw ?? '')
      .trim()
      .toLowerCase();
    if (code === '') return '';
    const group = await this.prisma.userGroup.findFirst({
      where: { activeKey: code, deletedAt: null },
      select: { id: true },
    });
    if (!group) {
      throw new AppError(40001, `用户分组 ${code} 不存在，请先在「用户分组」中创建`, 400);
    }
    return code;
  }

  /**
   * 删除未使用的会员套餐。
   *
   * free 是系统兜底等级，不能删；已有会员或订单的套餐承载着权益快照与
   * 历史对账关联，只能下架。预检后仍可能并发产生订阅，外键错误统一转成 409。
   */
  async remove(id: string) {
    const existing = await this.prisma.membershipPlan.findUnique({
      where: { id },
      select: {
        id: true,
        code: true,
        name: true,
        _count: { select: { memberships: true, orders: true } },
      },
    });
    if (!existing) throw new AppError(40400, '会员套餐不存在', 404);
    if (existing.code === 'free') {
      throw new AppError(40001, 'free 套餐由系统内置，不能删除', 400);
    }

    const memberCount = existing._count.memberships;
    const orderCount = existing._count.orders;
    if (memberCount > 0 || orderCount > 0) {
      throw new AppError(
        40901,
        `该套餐已有 ${memberCount} 名会员、${orderCount} 笔订单，不能删除；请改为下架`,
        409,
      );
    }

    try {
      await this.prisma.membershipPlan.delete({ where: { id } });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2003') {
        throw new AppError(40901, '该套餐刚刚产生了会员或订单，不能删除；请改为下架', 409);
      }
      throw error;
    }

    return { id, code: existing.code, name: existing.name };
  }

  async setStatus(id: string, input: SetPlanStatusInput) {
    const existing = await this.prisma.membershipPlan.findUnique({
      where: { id },
    });
    if (!existing) throw new AppError(40400, '会员套餐不存在', 404);
    if (existing.code === 'free' && input.status === 'offline') {
      throw new AppError(40001, 'free 套餐不能下架', 400);
    }

    const plan = await this.prisma.membershipPlan.update({
      where: { id },
      data: { status: input.status },
      include: { _count: { select: { memberships: true, orders: true } } },
    });
    return planView(plan);
  }
}
