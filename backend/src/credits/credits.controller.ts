import { Controller, Get, Query } from '@nestjs/common';
import { UseGuards } from '@nestjs/common';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Transform } from 'class-transformer';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { CurrentUser, AuthUser } from '../common/current-user.decorator';
import { CreditService } from './credit.service';

/** C 端积分流水查询。上限 200 与 service 端收敛值一致 */
export class CreditLedgerQueryDto {
  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : Number(value)))
  @IsInt({ message: 'limit 必须是整数' })
  @Min(1, { message: 'limit 最小为 1' })
  @Max(200, { message: 'limit 最大为 200' })
  limit?: number;

  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : Number(value)))
  @IsInt({ message: 'offset 必须是整数' })
  @Min(0, { message: 'offset 不能为负' })
  offset?: number;

  @IsOptional()
  @IsString()
  type?: string;

  @IsOptional()
  @IsIn(['income', 'expense'], { message: 'direction 取值非法' })
  direction?: 'income' | 'expense';

  @IsOptional()
  @IsString()
  businessType?: string;
}

/**
 * 批次查询参数。
 *
 * 保持原 `include !== 'false'` 的宽松语义：只有字面量 'false' 才排除过期批次，
 * 其余（缺省 / 'true' / 任意值）都包含。这里用 @Transform 把容错收敛在 DTO 层，
 * Controller 不再内联解析字符串；service 仍只收 boolean，签名与行为都不变。
 */
export class CreditLotsQueryDto {
  @IsOptional()
  @Transform(({ value }) => value !== 'false')
  @IsBoolean()
  includeExpired?: boolean;
}

/** C 端积分接口: 用户查自己的余额、批次与流水 */
@Controller('credits')
@UseGuards(JwtAuthGuard)
export class CreditsController {
  constructor(private readonly credit: CreditService) {}

  /** 余额总览 (B-49): 顶导展示用 */
  @Get('balance')
  balance(@CurrentUser() user: AuthUser) {
    return this.credit.balanceOf(user.id);
  }

  /** 批次明细 (B-50) */
  @Get('lots')
  lots(@CurrentUser() user: AuthUser, @Query() query: CreditLotsQueryDto) {
    return this.credit.lotsOf(user.id, query.includeExpired ?? true);
  }

  /** 流水查询 (B-51，支持 limit/offset 分页与 type/direction/businessType 筛选) */
  @Get('ledger')
  ledger(@CurrentUser() user: AuthUser, @Query() query: CreditLedgerQueryDto) {
    return this.credit.ledgerOf(user.id, query.limit ?? 50, {
      offset: query.offset ?? 0,
      type: query.type,
      direction: query.direction,
      businessType: query.businessType,
    });
  }
}
