/**
 * 日志模块。
 *
 * `@Global()` 的原因：AppFileLogger 是全站唯一的日志出口（main.ts 把它
 * 挂给 app.useLogger，异常过滤器与各 service 都经由它），若不设为全局，
 * 每个业务模块都得重复 imports，那正是要消灭的样板。
 *
 * 它依赖 ConfigService，所以必须在 AppModule.imports 里排在 ConfigModule 之后。
 */
import { Global, Module } from '@nestjs/common';
import { AppFileLogger } from './file-logger';

@Global()
@Module({
  providers: [AppFileLogger],
  exports: [AppFileLogger],
})
export class LoggerModule {}