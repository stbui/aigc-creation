"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppModule = void 0;
const common_1 = require("@nestjs/common");
const core_1 = require("@nestjs/core");
const config_module_1 = require("./config/config.module");
const logger_module_1 = require("./common/logger/logger.module");
const common_module_1 = require("./common/common.module");
const rate_limit_guard_1 = require("./common/rate-limit.guard");
const test_support_controller_1 = require("./common/test-support.controller");
const channels_module_1 = require("./channels/channels.module");
const all_exceptions_filter_1 = require("./common/all-exceptions.filter");
const prisma_module_1 = require("./prisma/prisma.module");
const auth_module_1 = require("./auth/auth.module");
const projects_module_1 = require("./projects/projects.module");
const assets_module_1 = require("./assets/assets.module");
const generate_module_1 = require("./generate/generate.module");
const capabilities_module_1 = require("./capabilities/capabilities.module");
const stats_module_1 = require("./stats/stats.module");
const admin_module_1 = require("./admin/admin.module");
const storage_module_1 = require("./storage/storage.module");
const credits_module_1 = require("./credits/credits.module");
const orders_module_1 = require("./orders/orders.module");
const payments_module_1 = require("./payments/payments.module");
const invoices_module_1 = require("./invoices/invoices.module");
const membership_module_1 = require("./membership/membership.module");
const marketing_module_1 = require("./marketing/marketing.module");
const products_module_1 = require("./products/products.module");
const prompt_tools_module_1 = require("./prompt-tools/prompt-tools.module");
const mobile_upload_module_1 = require("./mobile-upload/mobile-upload.module");
const account_module_1 = require("./account/account.module");
const legal_module_1 = require("./legal/legal.module");
const notifications_module_1 = require("./notifications/notifications.module");
const tickets_module_1 = require("./tickets/tickets.module");
const health_module_1 = require("./health/health.module");
const aigc_label_module_1 = require("./aigc-label/aigc-label.module");
const model_module_1 = require("./model/model.module");
const proxy_module_1 = require("./model/proxy/proxy.module");
let AppModule = class AppModule {
};
exports.AppModule = AppModule;
exports.AppModule = AppModule = __decorate([
    (0, common_1.Module)({
        imports: [
            // 顺序敏感: ConfigModule 必须最先 import —— 它 isGlobal,
            // 在此完成注册后 ConfigService 才对后面的模块可见 (见 config.module.ts)
            config_module_1.ConfigModule,
            logger_module_1.LoggerModule,
            // 横切服务（B5）：素材签名 URL。@Global, 必须排在业务模块之前
            common_module_1.CommonModule,
            // 外部消息通道 (邮件/短信) —— 全局模块, 必须排在 AuthModule 之前
            channels_module_1.ChannelsModule,
            // 站内消息 (B4) —— 全局模块: 支付/任务/调度都要发通知, 逐个 import 只会制造循环依赖
            notifications_module_1.NotificationsModule,
            prisma_module_1.PrismaModule,
            auth_module_1.AuthModule,
            projects_module_1.ProjectsModule,
            assets_module_1.AssetsModule,
            generate_module_1.GenerateModule,
            capabilities_module_1.CapabilitiesModule,
            stats_module_1.StatsModule,
            storage_module_1.StorageModule,
            credits_module_1.CreditsModule,
            orders_module_1.OrdersModule,
            // 支付通道 (B3): 发起支付 / 渠道回调 / 状态轮询。依赖 OrdersModule 入账
            payments_module_1.PaymentsModule,
            // 发票 (B3): C 端申请, 后台开具
            invoices_module_1.InvoicesModule,
            membership_module_1.MembershipModule,
            admin_module_1.AdminModule,
            // C 端商品 (公开免登录)。只依赖 Prisma, 不反向依赖任何业务模块
            products_module_1.ProductsModule,
            // C 端营销 (M11)。依赖 AdminModule 导出的 MarketingService,
            // 而 AdminModule 不依赖本模块 —— 单向, 无循环
            marketing_module_1.MarketingModule,
            // 提示词工具 (AI润色 / 图片转提示词)。走模型的 text 能力, 产出是文字不是图片,
            // 故不进 generate 任务体系。文本选路与协议调用由 ModelModule 的 TextToolService 提供。
            prompt_tools_module_1.PromptToolsModule,
            // 手机上传会话 (二维码 + 手机端收图)。依赖 Prisma 与 Storage。
            mobile_upload_module_1.MobileUploadModule,
            // 账户自助 (B4): 资料 / 改密 / 导出 / 注销
            account_module_1.AccountModule,
            // 法务文档 (B4): 公开读取 + 后台版本管理
            legal_module_1.LegalModule,
            // 工单/反馈 (B7): C 端提交与回复; 后台控制器在 AdminModule 复用本模块导出的 service
            tickets_module_1.TicketsModule,
            // 健康检查 (B5): /health 诊断 + /health/ready 就绪探针（无需鉴权）
            health_module_1.HealthModule,
            // AIGC 可见标识样式 (2026-10-21): 公开读展示参数 + 后台配置。
            // GenerateModule 依赖它取运行时素材，故必须排在 GenerateModule 之后亦可
            // （Nest 的模块图与 import 顺序无关），此处放在末尾更易读。
            aigc_label_module_1.AigcLabelModule,
            // 渠道与模型子系统（移植自 open-ai-canvas）。P0 只装无状态地基：
            // 凭证加密 / 协议注册表 / 内置插件清单 / 出站策略。
            model_module_1.ModelModule,
            // 代理中转（P6）：必须**最后一个**导入 —— 短路径入口
            // `/api/v1/:channelId/*path` 是 catch-all，排在业务路由之后才不会抢路由。
            proxy_module_1.ProxyModule,
        ],
        // 测试辅助接口（NODE_ENV=test 之外一律 404）：冒烟脚本用它重置限流计数。
        // 放在 AppModule 而不是 CommonModule —— 它要注入 RateLimitGuard 的**同一个实例**，
        // 而那个实例由下面的 APP_GUARD 注册产生（useExisting 复用）。
        controllers: [test_support_controller_1.TestSupportController],
        providers: [
            // 异常过滤器在此注册 (而非 main.ts 的 useGlobalFilters), 因为它要注入
            // AppFileLogger 才能落盘。⚠️ 与 useGlobalFilters 互斥, 只能二选一。
            { provide: core_1.APP_FILTER, useClass: all_exceptions_filter_1.AllExceptionsFilter },
            /*
             * 限流守卫是**全局**的, 但只在处理器/控制器标注了 @RateLimit 时生效
             * （无元数据直接放行）。这样新增受限接口只需加一个装饰器,
             * 不必逐个模块把守卫塞进 providers —— 漏塞的后果是"这条接口没限流",
             * 而且不会有任何报错。
             */
            // 先以类令牌注册实例，再让 APP_GUARD 复用它（useExisting）：
            // useClass 会另建一个实例，测试重置清的就不是真正在用的那份计数
            { provide: rate_limit_guard_1.RateLimitGuard, useClass: rate_limit_guard_1.RateLimitGuard },
            { provide: core_1.APP_GUARD, useExisting: rate_limit_guard_1.RateLimitGuard },
        ],
    })
], AppModule);
//# sourceMappingURL=app.module.js.map