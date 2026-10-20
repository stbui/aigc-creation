import { Module } from '@nestjs/common';
import { MarketingCoreModule } from './marketing-core.module';
import { MarketingPublicController, MarketingMeController } from './marketing.controller';

/**
 * C 端营销模块 (M11)。
 *
 * 只放 C 端控制器, 不放 admin 控制器 —— 后者留在 AdminModule 内,
 * 与其守卫/拦截器 (AdminGuard / PermissionGuard / AuditInterceptor) 同处。
 * 把 admin 端点放这里会导致权限校验链断裂, 是安全缺陷而非风格问题。
 *
 * MarketingService 由 MarketingCoreModule 提供 (该模块存在的唯一理由是
 * 打破 AdminModule ↔ OrdersModule 的循环依赖, 详见其文件注释)。
 */
@Module({
  imports: [MarketingCoreModule],
  controllers: [MarketingPublicController, MarketingMeController],
})
export class MarketingModule {}