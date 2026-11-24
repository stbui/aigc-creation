import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * 数据库模块 —— 全局可见。
 *
 * 为什么是 @Global: JwtAuthGuard 需要按请求校验账号状态 (禁用/注销的账号
 * 不能凭旧 token 继续访问), 而它是 `@UseGuards(JwtAuthGuard)` 形式挂在
 * 十几个功能模块上。守卫由**使用它的模块**的注入器实例化, 因此 PrismaService
 * 必须在每个模块可见 —— 漏掉一个模块就表现为运行时 `Cannot read properties
 * of undefined`, 而不是编译错误。
 *
 * 改成全局后, 只有 AppModule 显式 import 它（作为全局注册点）; 业务模块
 * 无需再写 imports —— 写了也不报错，但属于冗余样板。
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
