import { Controller, Get, Query } from '@nestjs/common';
import { UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { CurrentUser, AuthUser } from '../common/current-user.decorator';
import { CreditService } from './credit.service';

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

  /** 流水查询 (B-51) */
  @Get('ledger')
  ledger(@CurrentUser() user: AuthUser, @Query('limit') limit?: string) {
    const n = Number(limit ?? 50);
    return this.credit.ledgerOf(user.id, Number.isFinite(n) ? Math.min(n, 200) : 50);
  }
}
