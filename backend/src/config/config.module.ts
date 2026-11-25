/**
 * 全局配置模块。
 *
 * 在 AppModule.imports 里保持**第一项**，但原因不是 DI：
 *   `isGlobal: true` 的注册发生在模块图解析阶段，Nest 先解析完整个模块图才开始
 *   实例化 provider，所以 import 顺序不会让后来者「注入到 undefined」。
 *   真正敏感的是**导入期**：本模块被 require 时，forRoot() 就会解析 env 文件
 *   （12.x 的 async forRoot 中，解析位于第一个 await 之前），`expandVariables`
 *   再让 dotenv-expand 把文件值写回 process.env。于是任何在**类定义期**直读
 *   process.env 的代码都必须在本模块之后被 import；顺序错了不会报错，只会静默
 *   拿到兜底值 —— 表现为上传落到默认 `uploads/` 而不是 UPLOAD_DIR，最难查的一类。
 *
 *   上传落盘参数已不再有这种导入期依赖：它在 `assets/assets.module.ts` 的
 *   `MulterModule.registerAsync` 工厂里求值，工厂在实例化阶段执行，env 必然已
 *   加载完。同类代码（要把 env 值写进装饰器参数）请沿用这个做法，不要把
 *   `diskStorage(...)` 放回 `@UseInterceptors` 的参数里。
 *   若将来关掉 expandVariables，就必须改为在启动前显式加载 env 文件，
 *   上述「导入期直读」的写法才不会失效。
 *
 * envFilePath 的优先级：数组**靠前**的文件优先（同 .env.test.local > .env.test）。
 * 具体档位由 env-files.ts 按 NODE_ENV 决定，test/production 刻意不回落 `.env`
 * （否则会继承开发库的 DATABASE_URL，见该文件顶部说明）。
 * 所有文件都允许缺失，此时完全依赖外部环境变量（容器部署的常态）。
 */
import { Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { resolveEnvFiles } from './env-files';
import { validateEnv } from './env.validation';

@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      // .env 里可写 ASSET_PUBLIC_BASE=http://api.example.com:${PORT} 这类引用
      expandVariables: true,
      envFilePath: resolveEnvFiles(process.env.NODE_ENV),
      ignoreEnvFile: false,
      validate: validateEnv,
    }),
  ],
})
export class ConfigModule {}
