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
import { requestContextMiddleware } from './common/request-context';
import { createSignedAssetMiddleware } from './common/signed-asset.middleware';

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
  //
  // rawBody: 支付渠道回调必须基于**原始报文字节**验签 (微信 v3 的签名串里
  // 直接拼 body 字节)。用 JSON.stringify(parsed) 重新序列化会因为键顺序、
  // 空格、数字格式的差异得到不同字节, 表现为「签名永远验不过」。
  // 该选项不会影响上传: multipart 由 multer 处理, 与 bodyParser 无关。
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    rawBody: true,
  });
  const config = app.get(ConfigService);
  const logger = app.get(AppFileLogger);
  app.useLogger(logger);

  /*
   * 请求上下文必须最先注册: 它开 AsyncLocalStorage, 后续任何中间件、
   * 守卫、业务代码里的 currentRequestId() 都依赖这个上下文。
   * 注册在静态资源之前, /uploads 的 403 响应同样带 X-Request-Id。
   */
  app.use(requestContextMiddleware);

  /*
   * 是否信任反向代理的 X-Forwarded-For。
   * 默认 false: 直接暴露的实例若信任该头, 任何人伪造一个 IP 就能绕开
   * 全部按 IP 的限流 (登录爆破、短信刷量)。只有确实部署在 Nginx/LB 之后
   * 才打开 RATE_LIMIT_TRUST_PROXY=1, 且必须保证只有代理能连到本端口。
   */
  if (config.get<boolean>('rateLimit.trustProxy')) {
    app.set('trust proxy', 1);
    logger.warn('已信任 X-Forwarded-For（RATE_LIMIT_TRUST_PROXY=1）：仅当本服务位于可信代理之后时才可开启', 'Bootstrap');
  }

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
  // 默认放行本机 5100/4173, 私有网段需显式开启) —— 见 src/common/cors-allow-list.ts
  const cors = buildCorsAllowList();
  app.enableCors({
    origin: cors.origin,
    credentials: true,
    /*
     * ⚠ 必须包含 PUT: `PUT /api/v1/admin/credit-prices` 与营销规则更新
     * (`PUT /admin/invites/rules`、`PUT /admin/checkin/rules`) 都是 PUT。
     * 缺少它时浏览器预检直接失败, 表现为"跨域部署下这两页保存不生效",
     * 而本地同源开发 (Vite 代理) 一切正常 —— 典型的只在部署后复现的缺陷。
     */
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  /*
   * 素材签名校验必须在 useStaticAssets **之前**:
   * 静态中间件命中即响应, 注册在后面等于完全不校验。
   * ASSET_SIGNING_SECRET 为空时该中间件直接放行（保持原有公开行为）。
   */
  app.use(createSignedAssetMiddleware(config.get<string>('asset.signingSecret') ?? ''));

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

  // Docker/K8s 停止容器时先发 SIGTERM。开启 Nest 关闭钩子，让 Prisma 在退出前
  // 断开 SQLite 连接，避免正在提交的事务被硬中断。
  app.enableShutdownHooks();

  // 端口来自配置层 (PORT, 默认 4100); 监听地址来自 HOST (默认 127.0.0.1)。
  // ⚠ 生产/容器必须 HOST=0.0.0.0: 只绑回环的话容器外根本连不上,
  // 且 compose 里 service 之间的互通同样失败。开发态保持 127.0.0.1 是有意的 ——
  // 不把调试端口暴露到局域网。
  const port = config.get<number>('app.port') ?? 4100;
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
  // 安全面横切开关放在启动日志里回显: 「以为开了签名其实没配密钥」是最难查的一类问题
  const rateLimitOn = (process.env.RATE_LIMIT_ENABLED ?? 'true').toLowerCase() !== 'false';
  const signingOn = (config.get<string>('asset.signingSecret') ?? '').trim().length > 0;
  logger.log(
    `限流 ${rateLimitOn ? '开启' : '已关闭'} · 素材签名 ${signingOn ? '开启(/uploads 需 sig)' : '关闭(公开)'} · 健康检查 /api/v1/health`,
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
