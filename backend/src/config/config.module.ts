/**
 * 全局配置模块。
 *
 * 装配顺序为什么是「唯一要点」：
 *   AppModule.imports 的**第一项**必须是 ConfigModule。因为 `isGlobal: true`
 *   的模块只在被 import 的那一刻完成注册，它导出的 ConfigService 才是全局的；
 *   排在后面的模块（含 LoggerModule）才能安全注入 ConfigService。
 *   换句话说顺序错了不会立刻报错，而是运行期注入到 undefined —— 最难查的一类。
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