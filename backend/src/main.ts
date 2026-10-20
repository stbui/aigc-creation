import { NestFactory } from '@nestjs/core';
import {
  NestExpressApplication,
} from '@nestjs/platform-express';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { join, resolve } from 'path';
import * as fs from 'fs';
import { AppModule } from './app.module';
import { ResponseInterceptor } from './common/response.interceptor';
import { AppError } from './common/app.exception';
import { buildCorsAllowList } from './common/cors-allow-list';
import { AppFileLogger } from './common/logger/file-logger';

function flattenValidationErrors(errors: any[]): string {
  for (const error of errors) {
    if (error?.constraints && Object.keys(error.constraints).length > 0) {
      return Object.values(error.constraints)[0] as string;
    }
    if (error?.children && error.children.length > 0) {
      const nested = flattenValidationErrors(error.children);
      if (nested) return nested;
    }
  }
  return '参数校验失败';
}

async function bootstrap(): Promise<void> {
  // bufferLogs: DI 初始化期间的启动日志先缓存, 待 useLogger 换成落盘logger后
  // 一次性 flush —— 否则那批最关键的「谁在启动时失败了」会丢在默认 logger 里
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  const config = app.get(ConfigService);
  const logger = app.get(AppFileLogger);
  app.useLogger(logger);

  // 上传目录必须在 useStaticAssets 之前就位, 否则首次上传会 404。
  // 取自配置层 UPLOAD_DIR (三环境各写各的目录) —— 在此之前 mkdir 是不行的,
  // 因为 @nestjs/config 是在 NestFactory.create 内部才把 .env 读进 process.env。
  const uploadsDir = resolve(process.cwd(), config.get<string>('path.uploads') ?? 'uploads');
  fs.mkdirSync(join(uploadsDir, 'original'), { recursive: true });
  fs.mkdirSync(join(uploadsDir, 'generated'), { recursive: true });

  // 全局路由前缀: 前端 constants.ts API_PREFIX = '/api/v1'
  // (静态资源 /uploads/* 是 Express 中间件, 不受此前缀影响)
  app.setGlobalPrefix(config.get<string>('app.prefix') ?? 'api/v1');

  // CORS: 来源由 buildCorsAllowList 决定 (CORS_ORIGINS 显式白名单优先,
  // 默认放行本机 5173/4173, 私有网段需显式开启) —— 见 src/common/cors-allow-list.ts
  const cors = buildCorsAllowList();
  app.enableCors({
    origin: cors.origin,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  // 静态服务: GET /uploads/* 直接返回图片
  app.useStaticAssets(uploadsDir, { prefix: '/uploads' });

  // 全局参数校验
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: false,
      exceptionFactory: (errors) =>
        new AppError(40001, flattenValidationErrors(errors as any[]), 400),
    }),
  );

  // 统一响应包装与异常处理
  // 异常过滤器已在 AppModule 用 APP_FILTER 注册 (它要注入落盘 logger),
  // 此处不得再 useGlobalFilters —— 并存会导致过滤器执行两次
  app.useGlobalInterceptors(new ResponseInterceptor());

  // 端口来自配置层 (PORT, 默认 3001); 监听地址来自 HOST (默认 127.0.0.1)。
  // ⚠ 生产/容器必须 HOST=0.0.0.0: 只绑回环的话容器外根本连不上,
  // 且 compose 里 service 之间的互通同样失败。开发态保持 127.0.0.1 是有意的 ——
  // 不把调试端口暴露到局域网。
  const port = config.get<number>('app.port') ?? 3001;
  const host = config.get<string>('app.host') ?? '127.0.0.1';

  await app.listen(port, host);
  const nodeEnv = config.get<string>('app.env') ?? 'development';
  logger.log(
    `backend listening on http://${host}:${port} (prefix ${config.get('app.prefix')})`,
    'Bootstrap',
  );
  // 环境横幅: 三环境下最常见的乌龙是「以为在test 其实连着开发库」,
  // 所以把生效的环境名与库路径放在启动日志的第一屏。
  logger.log(
    `运行环境NODE_ENV=${nodeEnv} · 数据库 ${config.get('db.url')} · 上传目录 ${uploadsDir}`,
    'Bootstrap',
  );
  // 打印生效的 CORS 来源: CORS 问题的第一现场就是这里, 避免出现"配了但没生效"的盲查
  logger.log(
    `CORS origins: ${cors.effective.join(', ')}` +
      `${cors.privateLan ? ' + 私有网段(10./172.16-31./192.168.)' : ''}`,
    'Bootstrap',
  );
  logger.log(
    `前端必须用下列任一入口访问: ${cors.effective
      .filter((o) => !o.startsWith('http://192.168'))
      .join(' | ')}`,
    'Bootstrap',
  );
  logger.log(
    `日志落盘: ${logger.logDir || '(不可用, 已降级为仅控制台)'} · LOG_LEVEL=${config.get('log.level')} · 保留 ${config.get('log.retentionDays')} 天`,
    'Bootstrap',
  );
}

void bootstrap().catch((err: unknown) => {
  // 启动期失败此前是裸 unhandledRejection。这里显式接管, 保证:
  //   1) 退出码非 0 (start.sh 的 `kill -0` 探测能正确判定失败)
  //   2) 配置校验错误按它自己的多行清单打印, 而不是被压成一行 stack
  const e = err as { name?: string; message?: string; problems?: string[] };
  if (e?.name === 'EnvValidationError' && Array.isArray(e.problems)) {
    process.stderr.write(`\n[config] 环境变量校验失败：\n  - ${e.problems.join('\n  - ')}\n\n`);
    process.stderr.write('对照 backend/.env.example 逐项修正后重启。\n\n');
  } else {
    process.stderr.write(`\n[bootstrap] 后端启动失败: ${e?.message ?? String(err)}\n`);
    if ((err as Error)?.stack) process.stderr.write(`${(err as Error).stack}\n`);
  }
  process.exit(1);
});
