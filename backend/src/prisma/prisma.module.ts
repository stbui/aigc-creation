import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfigValues } from '../config/env.validation';
import {
  createPrismaClient,
  DEV_DATABASE_URL,
  PrismaService,
  PrismaLifecycle,
} from './prisma.service';

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
 *
 * 双方言: 注入令牌是 PrismaService（值即 PG PrismaClient 类), 实例由工厂按
 * `db.url` 协议构造（`file:` → SQLite client, 其余 → PG client)。选择逻辑与
 * 脚本 / 集成测试共用 `createPrismaClient`, 不在这里重写。
 */
@Global()
@Module({
  providers: [
    {
      provide: PrismaService,
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfigValues, true>) =>
        createPrismaClient(config.get<string>('db.url') ?? DEV_DATABASE_URL),
    },
    PrismaLifecycle,
  ],
  exports: [PrismaService],
})
export class PrismaModule {}
