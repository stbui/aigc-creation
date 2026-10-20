import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { PrismaModule } from '../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';
import { OrdersModule } from '../orders/orders.module';
import { CreditsModule } from '../credits/credits.module';
import { MembershipModule } from '../membership/membership.module';
import { ProvidersModule } from '../providers/providers.module';
import { AdminController } from './admin.controller';
import { AdminUsersController } from './users.controller';
import { AdminRolesController, AdminSettingsController } from './roles.controller';
import { AdminAuditController } from './audit.controller';
import { AdminBackupController } from './backup.controller';
import { AdminAssetsController } from './assets-admin.controller';
import { AdminStorageController } from './storage.controller';
import { AdminCommerceController } from './commerce.controller';
import { AdminSchedulerController } from './scheduler.controller';
import { AdminModelConfigController, AdminModelCallsController } from './model.controller';
import { AdminTasksController } from './tasks-admin.controller';
import {
  AdminCampaignsController,
  AdminCheckinController,
  AdminCouponsController,
  AdminInvitesController,
} from './marketing.controller';
import { AdminGuard } from './admin.guard';
import { PermissionGuard } from './permission.guard';
import { AuditInterceptor } from './audit.interceptor';
import { AdminRoleService } from './admin-role.service';
import { AdminOverviewService } from './overview.service';
import { AdminUsersService } from './users.service';
import { AdminSettingsService } from './settings.service';
import { AdminAuditService } from './audit.service';
import { BackupService } from './backup.service';
import { AdminAssetsService } from './assets-admin.service';
import { ModelConfigService } from './model-config.service';
import { ModelCallService } from './model-call.service';
import { TasksAdminService } from './tasks-admin.service';
import { MarketingCoreModule } from '../marketing/marketing-core.module';
import { GenerateModule } from '../generate/generate.module';
import { SchedulerService } from './scheduler.service';

/**
 * 后台模块。
 *
 * 守卫与拦截器在本模块内以 APP_GUARD / APP_INTERCEPTOR 注册 —— NestJS 中
 * 无论在哪个模块注册都是全局生效, 但放在本模块内才能正确解析 AdminRoleService
 * 等依赖 (若注册在 AppModule, AppModule 需导出 AdminRoleService, 徒增耦合)。
 *
 * 三者内部都对非 /admin 路径直接放行, 因此 C 端链路不受影响。
 * 执行顺序: AdminGuard (身份) → PermissionGuard (权限点) → controller → AuditInterceptor。
 *
 * ProvidersModule: ModelConfigService 保存配置后要主动失效运行时缓存,
 * 需注入同一个 CapabilityRouterProvider 实例 (否则缓存不失效, 改动要等 3s 才生效)。
 *
 * CreditsModule / OrdersModule: 商品订单页需要它们提供的 service。
 * MarketingCoreModule: 营销判定(券/活动)被后台配置、下单核销与 C 端试算共用。
 * 依赖是单向的 —— MarketingCoreModule 不反向依赖本模块, 因此无循环。
 *
 * GenerateModule: 任务重试 (B-32) 需复用 GenerateService.enqueue 触发执行,
 * 而 enqueue 是 processTask 的唯一调度入口 —— 各自实现一套调度迟早漂移。
 * GenerateModule 同样不反向依赖本模块。
 */
@Module({
  imports: [
    PrismaModule,
    StorageModule,
    ProvidersModule,
    CreditsModule,
    OrdersModule,
    MembershipModule,
    MarketingCoreModule,
    GenerateModule,
  ],
  controllers: [
    AdminController,
    AdminUsersController,
    AdminRolesController,
    AdminSettingsController,
    AdminAuditController,
    AdminBackupController,
    AdminAssetsController,
    AdminStorageController,
    AdminCommerceController,
    AdminModelConfigController,
    AdminModelCallsController,
    // 任务监控 (B-28~B-33)
    AdminTasksController,
    // 营销中心 (M11)
    AdminCouponsController,
    AdminCampaignsController,
    AdminInvitesController,
    AdminCheckinController,
    // 定时任务可观测 (B-90)
    AdminSchedulerController,
  ],
  providers: [
    AdminRoleService,
    AdminOverviewService,
    AdminUsersService,
    AdminSettingsService,
    AdminAuditService,
    BackupService,
    AdminAssetsService,
    ModelConfigService,
    ModelCallService,
    TasksAdminService,
    SchedulerService,
    { provide: APP_GUARD, useClass: AdminGuard },
    { provide: APP_GUARD, useClass: PermissionGuard },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
  // 供后续批次的子服务复用角色判定 (如订单退款前校验操作者)
  exports: [AdminRoleService, AdminAssetsService],
})
export class AdminModule {}