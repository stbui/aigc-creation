import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ConfigModule } from './config/config.module';
import { LoggerModule } from './common/logger/logger.module';
import { CommonModule } from './common/common.module';
import { RateLimitGuard } from './common/rate-limit.guard';
import { TestSupportController } from './common/test-support.controller';
import { ChannelsModule } from './channels/channels.module';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { ProjectsModule } from './projects/projects.module';
import { AssetsModule } from './assets/assets.module';
import { GenerateModule } from './generate/generate.module';
import { CapabilitiesModule } from './capabilities/capabilities.module';
import { StatsModule } from './stats/stats.module';
import { AdminModule } from './admin/admin.module';
import { StorageModule } from './storage/storage.module';
import { CreditsModule } from './credits/credits.module';
import { OrdersModule } from './orders/orders.module';
import { PaymentsModule } from './payments/payments.module';
import { InvoicesModule } from './invoices/invoices.module';
import { MembershipModule } from './membership/membership.module';
import { MarketingModule } from './marketing/marketing.module';
import { ProductsModule } from './products/products.module';
import { PromptToolsModule } from './prompt-tools/prompt-tools.module';
import { MobileUploadModule } from './mobile-upload/mobile-upload.module';
import { AccountModule } from './account/account.module';
import { LegalModule } from './legal/legal.module';
import { NotificationsModule } from './notifications/notifications.module';
import { TicketsModule } from './tickets/tickets.module';
import { HealthModule } from './health/health.module';
import { AigcLabelModule } from './aigc-label/aigc-label.module';

@Module({
  imports: [
    // 顺序敏感: ConfigModule 必须最先 import —— 它 isGlobal,
    // 在此完成注册后 ConfigService 才对后面的模块可见 (见 config.module.ts)
    ConfigModule,
    LoggerModule,
    // 横切服务（B5）：素材签名 URL。@Global, 必须排在业务模块之前
    CommonModule,
    // 外部消息通道 (邮件/短信) —— 全局模块, 必须排在 AuthModule 之前
    ChannelsModule,
    // 站内消息 (B4) —— 全局模块: 支付/任务/调度都要发通知, 逐个 import 只会制造循环依赖
    NotificationsModule,
    PrismaModule,
    AuthModule,
    ProjectsModule,
    AssetsModule,
    GenerateModule,
    CapabilitiesModule,
    StatsModule,
    StorageModule,
    CreditsModule,
    OrdersModule,
    // 支付通道 (B3): 发起支付 / 渠道回调 / 状态轮询。依赖 OrdersModule 入账
    PaymentsModule,
    // 发票 (B3): C 端申请, 后台开具
    InvoicesModule,
    MembershipModule,
    AdminModule,
    // C 端商品 (公开免登录)。只依赖 Prisma, 不反向依赖任何业务模块
    ProductsModule,
    // C 端营销 (M11)。依赖 AdminModule 导出的 MarketingService,
    // 而 AdminModule 不依赖本模块 —— 单向, 无循环
    MarketingModule,
    // 提示词工具 (AI润色 / 图片转提示词)。走文生文通道, 产出是文字不是图片,
    // 故不进 generate 任务体系。依赖 ProvidersModule 的 TEXT_PROVIDER。
    PromptToolsModule,
    // 手机上传会话 (二维码 + 手机端收图)。依赖 Prisma 与 Storage。
    MobileUploadModule,
    // 账户自助 (B4): 资料 / 改密 / 导出 / 注销
    AccountModule,
    // 法务文档 (B4): 公开读取 + 后台版本管理
    LegalModule,
    // 工单/反馈 (B7): C 端提交与回复; 后台控制器在 AdminModule 复用本模块导出的 service
    TicketsModule,
    // 健康检查 (B5): /health 诊断 + /health/ready 就绪探针（无需鉴权）
    HealthModule,
    // AIGC 可见标识样式 (2026-10-21): 公开读展示参数 + 后台配置。
    // GenerateModule 依赖它取运行时素材，故必须排在 GenerateModule 之后亦可
    // （Nest 的模块图与 import 顺序无关），此处放在末尾更易读。
    AigcLabelModule,
  ],
  // 测试辅助接口（NODE_ENV=test 之外一律 404）：冒烟脚本用它重置限流计数。
  // 放在 AppModule 而不是 CommonModule —— 它要注入 RateLimitGuard 的**同一个实例**，
  // 而那个实例由下面的 APP_GUARD 注册产生（useExisting 复用）。
  controllers: [TestSupportController],
  providers: [
    // 异常过滤器在此注册 (而非 main.ts 的 useGlobalFilters), 因为它要注入
    // AppFileLogger 才能落盘。⚠️ 与 useGlobalFilters 互斥, 只能二选一。
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    /*
     * 限流守卫是**全局**的, 但只在处理器/控制器标注了 @RateLimit 时生效
     * （无元数据直接放行）。这样新增受限接口只需加一个装饰器,
     * 不必逐个模块把守卫塞进 providers —— 漏塞的后果是"这条接口没限流",
     * 而且不会有任何报错。
     */
    // 先以类令牌注册实例，再让 APP_GUARD 复用它（useExisting）：
    // useClass 会另建一个实例，测试重置清的就不是真正在用的那份计数
    { provide: RateLimitGuard, useClass: RateLimitGuard },
    { provide: APP_GUARD, useExisting: RateLimitGuard },
  ],
})
export class AppModule {}