import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { ConfigModule } from './config/config.module';
import { LoggerModule } from './common/logger/logger.module';
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
import { MembershipModule } from './membership/membership.module';
import { MarketingModule } from './marketing/marketing.module';
import { ProductsModule } from './products/products.module';
import { PromptToolsModule } from './prompt-tools/prompt-tools.module';
import { MobileUploadModule } from './mobile-upload/mobile-upload.module';

@Module({
  imports: [
    // 顺序敏感: ConfigModule 必须最先 import —— 它 isGlobal,
    // 在此完成注册后 ConfigService 才对后面的模块可见 (见 config.module.ts)
    ConfigModule,
    LoggerModule,
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
  ],
  providers: [
    // 异常过滤器在此注册 (而非 main.ts 的 useGlobalFilters), 因为它要注入
    // AppFileLogger 才能落盘。⚠️ 与 useGlobalFilters 互斥, 只能二选一。
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}