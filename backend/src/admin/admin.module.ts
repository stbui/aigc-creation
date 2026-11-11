import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { PrismaModule } from '../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';
import { OrdersModule } from '../orders/orders.module';
import { CreditsModule } from '../credits/credits.module';
import { PricingModule } from '../credits/pricing.module';
import { MembershipModule } from '../membership/membership.module';
import { AdminController } from './admin.controller';
import { AdminUsersController } from './users.controller';
import { AdminRolesController, AdminSettingsController } from './roles.controller';
import { AdminBackupController } from './backup.controller';
import { AdminAssetsController } from './assets-admin.controller';
import { AdminStorageController } from './storage.controller';
import { AdminCommerceController } from './commerce.controller';
import {
  AdminMembershipPlansController,
  AdminMembershipPlansService,
} from './membership-plans.controller';
import { AdminRetentionController } from './retention.controller';
import { AdminInvoicesController } from './invoices-admin.controller';
import {
  AdminPaymentConfigController,
  AdminPaymentExceptionsController,
  AdminPaymentOrdersController,
  AdminPaymentReconciliationController,
} from './payments/payment-admin.controller';
import { AdminPaymentsService } from './payments/payment-admin.service';
import { PaymentsModule } from '../payments/payments.module';
import { InvoicesModule } from '../invoices/invoices.module';
import { AccountModule } from '../account/account.module';
import { AdminNotificationsController } from './notifications.controller';
import { AdminTicketsController } from './tickets-admin.controller';
import { AdminSearchController } from './search.controller';
import { AdminSearchService } from './search.service';
import { TicketsModule } from '../tickets/tickets.module';
import { AdminCommerceService } from './commerce-admin.service';
import { AdminSchedulerController } from './scheduler.controller';
import { AdminTasksController } from './tasks-admin.controller';
import { AdminAlertsController } from './alerts.controller';
import { AdminAlertsService } from './alerts.service';
import { AdminWorkbenchController } from './workbench.controller';
import { AdminWorkbenchService } from './workbench.service';
import { AdminCapabilitiesController } from './capability.controller';
import { CapabilitiesModule } from '../capabilities/capabilities.module';
import {
  AdminCampaignsController,
  AdminCheckinController,
  AdminCouponsController,
  AdminInvitesController,
} from './marketing.controller';
import { AdminGuard } from './admin.guard';
import { PermissionGuard } from './permission.guard';
import { AdminRoleService } from './admin-role.service';
import { AdminOverviewService } from './overview.service';
import { AdminUsersService } from './users.service';
import { AdminSettingsService } from './settings.service';
import { BackupService } from './backup.service';
import { AdminAssetsService } from './assets-admin.service';
import { TasksAdminService } from './tasks-admin.service';
import { MarketingCoreModule } from '../marketing/marketing-core.module';
import { GenerateModule } from '../generate/generate.module';
import { ModelModule } from '../model/model.module';
import { SchedulerService } from './scheduler.service';

/**
 * 后台模块。
 *
 * 守卫在本模块内以 APP_GUARD 注册 —— NestJS 中无论在哪个模块注册都是
 * 全局生效, 但放在本模块内才能正确解析 AdminRoleService 等依赖 (若注册在
 * AppModule, AppModule 需导出 AdminRoleService, 徒增耦合)。
 *
 * 守卫内部对非 /admin 路径直接放行, 因此 C 端链路不受影响。
 * 执行顺序: AdminGuard (身份) → PermissionGuard (权限点) → controller。
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
    CreditsModule,
    PricingModule,
    OrdersModule,
    MembershipModule,
    MarketingCoreModule,
    GenerateModule,
    // 用户详情要展示计费分组；UserGroupService 只在 ModelModule 导出，
    // 后台另读分组表会与 C 端会员→分组的映射规则漂移。
    ModelModule,
    // 支付充值页: 渠道配置、支付订单、对账全部复用支付域服务,
    // 不在后台另写一份「哪些通道可用」的规则 (两处判定必然漂移)
    PaymentsModule,
    // 发票: 复用 C 端的开票/渲染逻辑, 后台只做审核动作
    InvoicesModule,
    // 注销: 后台与 C 端自助注销复用同一份 AccountLifecycleService
    AccountModule,
    // 能力管控: 上下线状态与 C 端 GET /capabilities 共用同一份运行时判定
    CapabilitiesModule,
    // 工单: 后台只做流转与回复, 状态机集中在 TicketsService 一份,
    // C 端与后台若各写一套, 「resolved 后用户回复回落 open」这类规则必然漂移
    TicketsModule,
  ],
  controllers: [
    AdminController,
    AdminUsersController,
    AdminRolesController,
    AdminSettingsController,
    AdminBackupController,
    AdminAssetsController,
    AdminStorageController,
    AdminCommerceController,
    // 会员套餐：C 端价目表的唯一写入入口
    AdminMembershipPlansController,
    // 保留期清理 (B-96)
    AdminRetentionController,
    // 渠道对账 (B3)
    AdminPaymentConfigController,
    AdminPaymentOrdersController,
    AdminPaymentReconciliationController,
    AdminPaymentExceptionsController,
    // 发票审核 (B3)
    AdminInvoicesController,
    // 支付渠道状态 (只读): 凭据只从环境变量读

    // 站内消息广播/模板 (B4)
    AdminNotificationsController,
    // 工单处理中心 + 全局搜索 (B7)
    AdminTicketsController,
    AdminSearchController,
    // 任务监控 (B-28~B-33)
    AdminTasksController,
    // 顶栏告警中心：按权限聚合待处理工单 / 失败任务 / 对账差异 / 备份状态
    AdminAlertsController,
    // 角色工作台：首屏按角色给出可动作的实体队列，只读
    AdminWorkbenchController,
    AdminCapabilitiesController,
    // 营销中心 (M11)
    AdminCouponsController,
    AdminCampaignsController,
    AdminInvitesController,
    AdminCheckinController,
    // 定时任务可观测 (B-90)
    AdminSchedulerController,
  ],
  providers: [
    AdminPaymentsService,
    AdminRoleService,
    AdminOverviewService,
    AdminUsersService,
    AdminSettingsService,
    BackupService,
    AdminAssetsService,
    AdminCommerceService,
    AdminMembershipPlansService,
    TasksAdminService,
    AdminAlertsService,
    AdminWorkbenchService,
    AdminSearchService,
    SchedulerService,
    { provide: APP_GUARD, useClass: AdminGuard },
    { provide: APP_GUARD, useClass: PermissionGuard },
  ],
  // 供后续批次的子服务复用角色判定 (如订单退款前校验操作者)
  exports: [AdminRoleService, AdminAssetsService],
})
export class AdminModule {}
