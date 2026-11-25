/**
 * 全局配置模块。
 *
 * 在 AppModule.imports 里保持**第一项**，但原因不是 DI：
 *   `isGlobal: true` 的注册发生在模块图解析阶段，Nest 先解析完整个模块图才开始
 *   实例化 provider，所以 import 顺序不会让后来者「注入到 undefined」。
 *   真正敏感的是**导入期**：本模块被 require 时，forRoot() 就会解析 env 文件
 *   （12.x 的 async forRoot 中，解析位于第一个 await 之前），`expandVariables`
 *   再让 dotenv-expand 把文件值写回 process.env。于是类定义期直接读
 *   process.env 的代码（如 assets.controller 的 multer destination）必须在
 *   本模块之后被 import；顺序错了不会报错，只会静默拿到兜底值 —— 表现为
 *   上传落到默认 `uploads/` 而不是 UPLOAD_DIR，最难查的一类。
 *   若将来关掉 expandVariables，就必须改为在启动前显式加载 env 文件，
 *   上述导入期依赖才不会失效。
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
  exports: [NestConfigModule],
})
export class ConfigModule {}