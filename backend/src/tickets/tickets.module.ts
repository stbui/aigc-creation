/**
 * 工单模块。
 *
 * 导出 TicketsService 供后台复用：工单的状态机、越权规则、通知文案
 * 只有一份。AdminModule 导入本模块而不是自己再查一遍 ticket 表 ——
 * 两套实现最先漂移的正是「谁能回复已关闭的工单」这类规则。
 */
import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { TicketsController } from './tickets.controller';
import { TicketsService } from './tickets.service';

@Module({
  imports: [PrismaModule],
  controllers: [TicketsController],
  providers: [TicketsService],
  exports: [TicketsService],
})
export class TicketsModule {}
