/**
 * 站内消息模块。
 *
 * 设为 `@Global()`（与 ChannelsModule 同理）：支付回调、任务执行、
 * 调度任务都要发通知，逐个 import 只会制造样板与循环依赖风险。
 * 模块自身只依赖 Prisma，无业务耦合。
 */
import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

@Global()
@Module({
  imports: [PrismaModule],
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
