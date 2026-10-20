import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { CreditsModule } from '../credits/credits.module';
import { MembershipController } from './membership.controller';
import { MembershipService } from './membership.service';

/**
 * 会员模块。
 *
 * MembershipService 被订单(折扣)、生成(并发校验/快速通道)、
 * 调度器(月度积分) 共用, 因此导出。
 */
@Module({
  imports: [PrismaModule, CreditsModule],
  controllers: [MembershipController],
  providers: [MembershipService],
  exports: [MembershipService],
})
export class MembershipModule {}
