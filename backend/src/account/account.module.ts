import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AccountController } from './account.controller';
import { AccountLifecycleService } from './account-lifecycle.service';
import { AccountService } from './account.service';

/**
 * 账户自助（资料 / 改密 / 导出 / 注销）。
 *
 * `AccountLifecycleService` 导出：后台用户管理复用同一份注销实现，
 * 避免两条链路各删各的子表。
 */
@Module({
  imports: [PrismaModule],
  controllers: [AccountController],
  providers: [AccountService, AccountLifecycleService],
  exports: [AccountService, AccountLifecycleService],
})
export class AccountModule {}
