import {
  Body,
  Controller,
  Get,
  Injectable,
  Param,
  Patch,
  Post,
} from "@nestjs/common";
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";
import { PrismaService } from "../prisma/prisma.service";
import { AppError } from "../common/app.exception";
import { AuditAction, RequirePermission } from "./admin.decorator";
import { PERMISSIONS } from "./permissions";
import {
  MembershipService,
  buildPerkLabels,
  parsePerks,
  type Perks,
} from "../membership/membership.service";

/** 权益入参。与 C 端 `parsePerks` 的字段一致，避免后台写进 C 端读不懂的 JSON */
class PlanPerksDto {
  @IsOptional()
  @IsBoolean()
  fastChannel?: boolean;

  /** 同时进行中任务上限。0 = 不限 */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  maxConcurrent?: number;

  /** 加油包折扣万分比。10000 = 无折扣 */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10000)
  addonDiscountBps?: number;
}

class CreateMembershipPlanDto {
  @IsString()
  @Matches(/^[a-z0-9][a-z0-9_-]{1,39}$/, {
    message: "编码只能是小写字母/数字/下划线/短横线，长度 2~40",
  })
  code!: string;

  @IsString()
  @MaxLength(40)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string;

  /** 整数分。会员订阅价 */
  @IsInt()
  @Min(0)
  priceCents!: number;

  /** 周期天数。0 = 永久（仅 free 套餐可用） */
  @IsInt()
  @Min(0)
  @Max(3650)
  durationDays!: number;

  @IsInt()
  @Min(0)
  @Max(1000000)
  monthlyCredits!: number;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => PlanPerksDto)
  perks?: PlanPerksDto;

  @IsOptional()
  @IsIn(["active", "offline"])
  status?: "active" | "offline";

  @IsOptional()
  @IsInt()
  sortOrder?: number;

  /**
   * 会员等级映射的用户分组。
   *
   * 分组决定该等级用户可见的渠道与价格倍率（`docs/channel-model-design.md` §6.4）。
   * 留空 = 落 `default` 分组。**运营必须显式配**：不配的话所有等级都落默认组，
   * 分组倍率与模型级覆盖在真实数据下永不生效 —— 界面上却看不出任何异常。
   */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  userGroupCode?: string;
}

class UpdateMembershipPlanDto {
  @IsOptional()
  @IsString()
  @MaxLength(40)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  priceCents?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(3650)
  durationDays?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000000)
  monthlyCredits?: number;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => PlanPerksDto)
  perks?: PlanPerksDto;

  @IsOptional()
  @IsInt()
  sortOrder?: number;

  /**
   * 会员等级映射的用户分组；留空 = 落 `default` 分组。
   *
   * 改这一项等于改「这一等级能看到哪些渠道、按什么倍率计价」，属于高危变更。
   */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  userGroupCode?: string;
}

class PlanStatusDto {
  @IsIn(["active", "offline"])
  status!: "active" | "offline";
}

/** 归一化权益：缺省字段补齐，避免库里出现半份 JSON */
function normalizePerks(input?: PlanPerksDto): Perks {
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
    userGroupCode: plan.userGroupCode ?? "",
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
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      include: { _count: { select: { memberships: true, orders: true } } },
    });
    return { items: plans.map(planView) };
  }

  async create(dto: CreateMembershipPlanDto) {
    if (dto.code === "free") {
      throw new AppError(40001, "free 套餐由系统内置，不能重复创建", 400);
    }
    if (dto.durationDays === 0) {
      throw new AppError(40001, "可购买的套餐周期必须大于 0 天", 400);
    }
    const perks = normalizePerks(dto.perks);
    const exists = await this.prisma.membershipPlan.findUnique({
      where: { code: dto.code },
    });
    if (exists) throw new AppError(40901, `套餐编码 ${dto.code} 已存在`, 409);
    const userGroupCode = await this.resolveUserGroupCode(dto.userGroupCode);

    const plan = await this.prisma.membershipPlan.create({
      data: {
        code: dto.code,
        name: dto.name,
        description: dto.description ?? "",
        priceCents: dto.priceCents,
        durationDays: dto.durationDays,
        monthlyCredits: dto.monthlyCredits,
        perks: JSON.stringify(perks),
        // 默认下架：运营建完套餐应先核对价目与权益，再手动上架
        status: dto.status ?? "offline",
        sortOrder: dto.sortOrder ?? 0,
        userGroupCode,
      },
      include: { _count: { select: { memberships: true, orders: true } } },
    });
    return planView(plan);
  }

  async update(id: string, dto: UpdateMembershipPlanDto) {
    const existing = await this.prisma.membershipPlan.findUnique({
      where: { id },
    });
    if (!existing) throw new AppError(40400, "会员套餐不存在", 404);

    if (existing.code === "free") {
      if (dto.priceCents !== undefined && dto.priceCents !== 0) {
        throw new AppError(40001, "free 套餐必须保持 0 元", 400);
      }
      if (dto.durationDays !== undefined && dto.durationDays !== 0) {
        throw new AppError(40001, "free 套餐必须是永久有效", 400);
      }
    } else if (dto.durationDays === 0) {
      throw new AppError(40001, "可购买的套餐周期必须大于 0 天", 400);
    }

    const data: Record<string, unknown> = {};
    for (const key of [
      "name",
      "description",
      "priceCents",
      "durationDays",
      "monthlyCredits",
      "sortOrder",
    ] as const) {
      if (dto[key] !== undefined) data[key] = dto[key];
    }
    if (dto.perks !== undefined) {
      // 修改权益只影响新订单；存量会员用 Membership.perksSnapshot，不会被追溯改价
      data.perks = JSON.stringify(normalizePerks(dto.perks));
    }
    if (dto.userGroupCode !== undefined) {
      data.userGroupCode = await this.resolveUserGroupCode(dto.userGroupCode);
    }

    const plan = await this.prisma.membershipPlan.update({
      where: { id },
      data,
      include: { _count: { select: { memberships: true, orders: true } } },
    });
    // 历史订单没有分组快照时仍回退当前套餐映射；后台改动后必须立刻失效
    // 用户分组缓存，否则最多 30 秒内新旧订单可能读取到不一致映射。
    if (dto.userGroupCode !== undefined) {
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
    const code = String(raw ?? "")
      .trim()
      .toLowerCase();
    if (code === "") return "";
    const group = await this.prisma.userGroup.findFirst({
      where: { activeKey: code, deletedAt: null },
      select: { id: true },
    });
    if (!group)
      throw new AppError(
        40001,
        `用户分组 ${code} 不存在，请先在「用户分组」中创建`,
        400,
      );
    return code;
  }

  async setStatus(id: string, dto: PlanStatusDto) {
    const existing = await this.prisma.membershipPlan.findUnique({
      where: { id },
    });
    if (!existing) throw new AppError(40400, "会员套餐不存在", 404);
    if (existing.code === "free" && dto.status === "offline") {
      throw new AppError(40001, "free 套餐不能下架", 400);
    }

    const plan = await this.prisma.membershipPlan.update({
      where: { id },
      data: { status: dto.status },
      include: { _count: { select: { memberships: true, orders: true } } },
    });
    return planView(plan);
  }
}

@Controller("admin/membership-plans")
export class AdminMembershipPlansController {
  constructor(private readonly plans: AdminMembershipPlansService) {}

  @Get()
  @RequirePermission(PERMISSIONS.productRead)
  list() {
    return this.plans.list();
  }

  @Post()
  @RequirePermission(PERMISSIONS.productWrite)
  @AuditAction("membership-plan.create")
  create(@Body() dto: CreateMembershipPlanDto) {
    return this.plans.create(dto);
  }

  @Patch(":id")
  @RequirePermission(PERMISSIONS.productWrite)
  @AuditAction("membership-plan.update")
  update(@Param("id") id: string, @Body() dto: UpdateMembershipPlanDto) {
    return this.plans.update(id, dto);
  }

  @Patch(":id/status")
  @RequirePermission(PERMISSIONS.productWrite)
  @AuditAction("membership-plan.status")
  setStatus(@Param("id") id: string, @Body() dto: PlanStatusDto) {
    return this.plans.setStatus(id, dto);
  }
}
