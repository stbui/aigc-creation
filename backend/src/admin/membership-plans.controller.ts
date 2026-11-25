import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { Type } from 'class-transformer';
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
} from 'class-validator';
import { RequirePermission } from './admin.decorator';
import { AdminMembershipPlansService } from './membership-plans.service';
import { PERMISSIONS } from './permissions';

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
    message: '编码只能是小写字母/数字/下划线/短横线，长度 2~40',
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
  @IsIn(['active', 'offline'])
  status?: 'active' | 'offline';

  @IsOptional()
  @IsInt()
  sortOrder?: number;

  /**
   * 会员等级映射的用户分组。
   *
   * 分组决定该等级用户可见的渠道与价格倍率（`docs/model-architecture.md` §6）。
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
  @IsIn(['active', 'offline'])
  status!: 'active' | 'offline';
}

/** 会员套餐管理：C 端价目表的唯一写入入口 */
@Controller('admin/membership-plans')
export class AdminMembershipPlansController {
  constructor(private readonly plans: AdminMembershipPlansService) {}

  @Get()
  @RequirePermission(PERMISSIONS.productRead)
  list() {
    return this.plans.list();
  }

  @Post()
  @RequirePermission(PERMISSIONS.productWrite)
  create(@Body() dto: CreateMembershipPlanDto) {
    return this.plans.create({
      code: dto.code,
      name: dto.name,
      description: dto.description,
      priceCents: dto.priceCents,
      durationDays: dto.durationDays,
      monthlyCredits: dto.monthlyCredits,
      perks: dto.perks
        ? {
            fastChannel: dto.perks.fastChannel,
            maxConcurrent: dto.perks.maxConcurrent,
            addonDiscountBps: dto.perks.addonDiscountBps,
          }
        : undefined,
      status: dto.status,
      sortOrder: dto.sortOrder,
      userGroupCode: dto.userGroupCode,
    });
  }

  @Patch(':id')
  @RequirePermission(PERMISSIONS.productWrite)
  update(@Param('id') id: string, @Body() dto: UpdateMembershipPlanDto) {
    return this.plans.update(id, {
      name: dto.name,
      description: dto.description,
      priceCents: dto.priceCents,
      durationDays: dto.durationDays,
      monthlyCredits: dto.monthlyCredits,
      perks: dto.perks
        ? {
            fastChannel: dto.perks.fastChannel,
            maxConcurrent: dto.perks.maxConcurrent,
            addonDiscountBps: dto.perks.addonDiscountBps,
          }
        : undefined,
      sortOrder: dto.sortOrder,
      userGroupCode: dto.userGroupCode,
    });
  }

  @Patch(':id/status')
  @RequirePermission(PERMISSIONS.productWrite)
  setStatus(@Param('id') id: string, @Body() dto: PlanStatusDto) {
    return this.plans.setStatus(id, { status: dto.status });
  }

  @Delete(':id')
  @RequirePermission(PERMISSIONS.productWrite)
  remove(@Param('id') id: string) {
    return this.plans.remove(id);
  }
}
