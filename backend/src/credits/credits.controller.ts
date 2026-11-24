import { Controller, Get, Query } from '@nestjs/common';
import { UseGuards } from '@nestjs/common';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
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
  lots(@CurrentUser() user: AuthUser, @Query('includeExpired') include?: string) {
    return this.credit.lotsOf(user.id, include !== 'false');
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
