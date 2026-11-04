"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AdminModule = void 0;
const common_1 = require("@nestjs/common");
const core_1 = require("@nestjs/core");
const prisma_module_1 = require("../prisma/prisma.module");
const storage_module_1 = require("../storage/storage.module");
const orders_module_1 = require("../orders/orders.module");
const credits_module_1 = require("../credits/credits.module");
const membership_module_1 = require("../membership/membership.module");
const admin_controller_1 = require("./admin.controller");
const users_controller_1 = require("./users.controller");
const roles_controller_1 = require("./roles.controller");
const audit_controller_1 = require("./audit.controller");
const backup_controller_1 = require("./backup.controller");
const assets_admin_controller_1 = require("./assets-admin.controller");
const storage_controller_1 = require("./storage.controller");
const commerce_controller_1 = require("./commerce.controller");
const membership_plans_controller_1 = require("./membership-plans.controller");
const retention_controller_1 = require("./retention.controller");
const invoices_admin_controller_1 = require("./invoices-admin.controller");
const payment_admin_controller_1 = require("./payments/payment-admin.controller");
const payment_admin_service_1 = require("./payments/payment-admin.service");
const payments_module_1 = require("../payments/payments.module");
const invoices_module_1 = require("../invoices/invoices.module");
const legal_module_1 = require("../legal/legal.module");
const account_module_1 = require("../account/account.module");
const legal_controller_1 = require("./legal.controller");
const notifications_controller_1 = require("./notifications.controller");
const tickets_admin_controller_1 = require("./tickets-admin.controller");
const search_controller_1 = require("./search.controller");
const search_service_1 = require("./search.service");
const tickets_module_1 = require("../tickets/tickets.module");
const commerce_admin_service_1 = require("./commerce-admin.service");
const scheduler_controller_1 = require("./scheduler.controller");
const tasks_admin_controller_1 = require("./tasks-admin.controller");
const alerts_controller_1 = require("./alerts.controller");
const alerts_service_1 = require("./alerts.service");
const capability_controller_1 = require("./capability.controller");
const capabilities_module_1 = require("../capabilities/capabilities.module");
const marketing_controller_1 = require("./marketing.controller");
const admin_guard_1 = require("./admin.guard");
const permission_guard_1 = require("./permission.guard");
const audit_interceptor_1 = require("./audit.interceptor");
const admin_role_service_1 = require("./admin-role.service");
const overview_service_1 = require("./overview.service");
const users_service_1 = require("./users.service");
const settings_service_1 = require("./settings.service");
const audit_service_1 = require("./audit.service");
const backup_service_1 = require("./backup.service");
const assets_admin_service_1 = require("./assets-admin.service");
const tasks_admin_service_1 = require("./tasks-admin.service");
const marketing_core_module_1 = require("../marketing/marketing-core.module");
const generate_module_1 = require("../generate/generate.module");
const scheduler_service_1 = require("./scheduler.service");
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
 * CreditsModule / OrdersModule: 商品订单页需要它们提供的 service。
 * MarketingCoreModule: 营销判定(券/活动)被后台配置、下单核销与 C 端试算共用。
 * 依赖是单向的 —— MarketingCoreModule 不反向依赖本模块, 因此无循环。
 *
 * GenerateModule: 任务重试 (B-32) 需复用 GenerateService.enqueue 触发执行,
 * 而 enqueue 是 processTask 的唯一调度入口 —— 各自实现一套调度迟早漂移。
 * GenerateModule 同样不反向依赖本模块。
 */
let AdminModule = class AdminModule {
};
exports.AdminModule = AdminModule;
exports.AdminModule = AdminModule = __decorate([
    (0, common_1.Module)({
        imports: [
            prisma_module_1.PrismaModule,
            storage_module_1.StorageModule,
            credits_module_1.CreditsModule,
            orders_module_1.OrdersModule,
            membership_module_1.MembershipModule,
            marketing_core_module_1.MarketingCoreModule,
            generate_module_1.GenerateModule,
            // 支付充值页: 渠道配置、支付订单、对账全部复用支付域服务,
            // 不在后台另写一份「哪些通道可用」的规则 (两处判定必然漂移)
            payments_module_1.PaymentsModule,
            // 发票: 复用 C 端的开票/渲染逻辑, 后台只做审核动作
            invoices_module_1.InvoicesModule,
            // 法务: 后台版本管理复用 C 端的版本解析与发布规则
            legal_module_1.LegalModule,
            // 注销: 后台与 C 端自助注销复用同一份 AccountLifecycleService
            account_module_1.AccountModule,
            // 能力管控: 上下线状态与 C 端 GET /capabilities 共用同一份运行时判定
            capabilities_module_1.CapabilitiesModule,
            // 工单: 后台只做流转与回复, 状态机集中在 TicketsService 一份,
            // C 端与后台若各写一套, 「resolved 后用户回复回落 open」这类规则必然漂移
            tickets_module_1.TicketsModule,
        ],
        controllers: [
            admin_controller_1.AdminController,
            users_controller_1.AdminUsersController,
            roles_controller_1.AdminRolesController,
            roles_controller_1.AdminSettingsController,
            audit_controller_1.AdminAuditController,
            backup_controller_1.AdminBackupController,
            assets_admin_controller_1.AdminAssetsController,
            storage_controller_1.AdminStorageController,
            commerce_controller_1.AdminCommerceController,
            // 会员套餐：C 端价目表的唯一写入入口
            membership_plans_controller_1.AdminMembershipPlansController,
            // 保留期清理 (B-96)
            retention_controller_1.AdminRetentionController,
            // 渠道对账 (B3)
            payment_admin_controller_1.AdminPaymentConfigController,
            payment_admin_controller_1.AdminPaymentOrdersController,
            payment_admin_controller_1.AdminPaymentReconciliationController,
            // 发票审核 (B3)
            invoices_admin_controller_1.AdminInvoicesController,
            // 支付渠道状态 (只读): 凭据只从环境变量读
            // 法务文档版本管理 + 站内消息广播/模板 (B4)
            legal_controller_1.AdminLegalController,
            notifications_controller_1.AdminNotificationsController,
            // 工单处理中心 + 全局搜索 (B7)
            tickets_admin_controller_1.AdminTicketsController,
            search_controller_1.AdminSearchController,
            // 任务监控 (B-28~B-33)
            tasks_admin_controller_1.AdminTasksController,
            // 顶栏告警中心：按权限聚合待处理工单 / 失败任务 / 对账差异 / 备份状态
            alerts_controller_1.AdminAlertsController,
            capability_controller_1.AdminCapabilitiesController,
            // 营销中心 (M11)
            marketing_controller_1.AdminCouponsController,
            marketing_controller_1.AdminCampaignsController,
            marketing_controller_1.AdminInvitesController,
            marketing_controller_1.AdminCheckinController,
            // 定时任务可观测 (B-90)
            scheduler_controller_1.AdminSchedulerController,
        ],
        providers: [
            payment_admin_service_1.AdminPaymentsService,
            admin_role_service_1.AdminRoleService,
            overview_service_1.AdminOverviewService,
            users_service_1.AdminUsersService,
            settings_service_1.AdminSettingsService,
            audit_service_1.AdminAuditService,
            backup_service_1.BackupService,
            assets_admin_service_1.AdminAssetsService,
            commerce_admin_service_1.AdminCommerceService,
            membership_plans_controller_1.AdminMembershipPlansService,
            tasks_admin_service_1.TasksAdminService,
            alerts_service_1.AdminAlertsService,
            search_service_1.AdminSearchService,
            scheduler_service_1.SchedulerService,
            { provide: core_1.APP_GUARD, useClass: admin_guard_1.AdminGuard },
            { provide: core_1.APP_GUARD, useClass: permission_guard_1.PermissionGuard },
            { provide: core_1.APP_INTERCEPTOR, useClass: audit_interceptor_1.AuditInterceptor },
        ],
        // 供后续批次的子服务复用角色判定 (如订单退款前校验操作者)
        exports: [admin_role_service_1.AdminRoleService, assets_admin_service_1.AdminAssetsService],
    })
], AdminModule);
//# sourceMappingURL=admin.module.js.map