"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = require("@nestjs/core");
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const express = __importStar(require("express"));
const path_1 = require("path");
const fs = __importStar(require("fs"));
const app_module_1 = require("./app.module");
const response_interceptor_1 = require("./common/response.interceptor");
const app_exception_1 = require("./common/app.exception");
const cors_allow_list_1 = require("./common/cors-allow-list");
const file_logger_1 = require("./common/logger/file-logger");
const request_context_1 = require("./common/request-context");
const signed_asset_middleware_1 = require("./common/signed-asset.middleware");
const asset_thumbnail_middleware_1 = require("./assets/asset-thumbnail.middleware");
const proxy_paths_1 = require("./model/proxy/proxy.paths");
function flattenValidationErrors(errors) {
    for (const error of errors) {
        if (error?.constraints && Object.keys(error.constraints).length > 0) {
            return Object.values(error.constraints)[0];
        }
        if (error?.children && error.children.length > 0) {
            const nested = flattenValidationErrors(error.children);
            if (nested)
                return nested;
        }
    }
    return '参数校验失败';
}
async function bootstrap() {
    // bufferLogs: DI 初始化期间的启动日志先缓存, 待 useLogger 换成落盘logger后
    // 一次性 flush —— 否则那批最关键的「谁在启动时失败了」会丢在默认 logger 里
    //
    // bodyParser: false —— 请求体解析改为下方自行注册, 以便**跳过中转路径**:
    // 中转要原样转发数 MB 的 JSON (多模态 messages 内嵌 base64), 内置解析器的
    // 100KB 上限会在业务代码之前直接 413。解析器与 rawBody 的语义保持与 Nest
    // 默认完全一致 (同一个 express.json / urlencoded + verify 挂 rawBody)。
    //
    // rawBody 仍然必须保留: 支付渠道回调要基于**原始报文字节**验签 (微信 v3 的
    // 签名串里直接拼 body 字节)。用 JSON.stringify(parsed) 重新序列化会因为键
    // 顺序、空格、数字格式的差异得到不同字节, 表现为「签名永远验不过」。
    // 该选项不会影响上传: multipart 由 multer 处理, 与 bodyParser 无关。
    const app = await core_1.NestFactory.create(app_module_1.AppModule, {
        bufferLogs: true,
        bodyParser: false,
    });
    const config = app.get(config_1.ConfigService);
    const logger = app.get(file_logger_1.AppFileLogger);
    app.useLogger(logger);
    const apiPrefix = config.get('app.prefix') ?? 'api/v1';
    /*
     * 请求体解析。默认行为与 Nest 内置一致 (json + urlencoded, 各 100KB,
     * `req.rawBody` 为原始字节); 唯一例外是**中转路径完全不解析** ——
     * 由 `readProxyBody` 按 `MODEL_PROXY_*` 的上限自行读取原始流。
     *
     * 判定必须与短路径中转控制器共用同一份保留前缀清单 (`isProxyRequestPath`),
     * 否则会出现「路由认为是中转、解析器认为是业务接口」的错位: 请求体被
     * 100KB 卡死, 或者被解析成对象后再也拿不到原始字节。
     */
    const captureRawBody = (req, _res, buf) => {
        if (buf?.length)
            req.rawBody = Buffer.from(buf);
    };
    const jsonParser = express.json({ limit: '100kb', verify: captureRawBody });
    const urlencodedParser = express.urlencoded({ extended: true, limit: '100kb', verify: captureRawBody });
    app.use((req, res, next) => {
        if ((0, proxy_paths_1.isProxyRequestPath)(req.path, apiPrefix)) {
            next();
            return;
        }
        jsonParser(req, res, (error) => {
            if (error) {
                next(error);
                return;
            }
            urlencodedParser(req, res, next);
        });
    });
    /*
     * 请求上下文必须最先注册: 它开 AsyncLocalStorage, 后续任何中间件、
     * 守卫、业务代码里的 currentRequestId() 都依赖这个上下文。
     * 注册在静态资源之前, /uploads 的 403 响应同样带 X-Request-Id。
     */
    app.use(request_context_1.requestContextMiddleware);
    /*
     * 是否信任反向代理的 X-Forwarded-For。
     * 默认 false: 直接暴露的实例若信任该头, 任何人伪造一个 IP 就能绕开
     * 全部按 IP 的限流 (登录爆破、短信刷量)。只有确实部署在 Nginx/LB 之后
     * 才打开 RATE_LIMIT_TRUST_PROXY=1, 且必须保证只有代理能连到本端口。
     */
    if (config.get('rateLimit.trustProxy')) {
        app.set('trust proxy', 1);
        logger.warn('已信任 X-Forwarded-For（RATE_LIMIT_TRUST_PROXY=1）：仅当本服务位于可信代理之后时才可开启', 'Bootstrap');
    }
    // 上传目录必须在 useStaticAssets 之前就位, 否则首次上传会 404。
    // 取自配置层 UPLOAD_DIR (三环境各写各的目录) —— 在此之前 mkdir 是不行的,
    // 因为 @nestjs/config 是在 NestFactory.create 内部才把 .env 读进 process.env。
    const uploadsDir = (0, path_1.resolve)(process.cwd(), config.get('path.uploads') ?? 'uploads');
    fs.mkdirSync((0, path_1.join)(uploadsDir, 'original'), { recursive: true });
    fs.mkdirSync((0, path_1.join)(uploadsDir, 'generated'), { recursive: true });
    // 全局路由前缀: 前端 constants.ts API_PREFIX = '/api/v1'
    // (静态资源 /uploads/* 是 Express 中间件, 不受此前缀影响)
    app.setGlobalPrefix(apiPrefix);
    // CORS: 来源由 buildCorsAllowList 决定 (CORS_ORIGINS 显式白名单优先,
    // 默认放行本机 5100, 私有网段需显式开启) —— 见 src/common/cors-allow-list.ts
    const cors = (0, cors_allow_list_1.buildCorsAllowList)();
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
        /*
         * x-canvas-* 是自定义渠道中转的对外契约（上游地址 / 格式 / 密钥 / 附加头），
         * x-idempotency-key 用于重放同一笔调用 —— 浏览器侧 SDK 直接调用时必须能
         * 通过预检，否则只在跨域部署下失败。常量定义见 `model/proxy/proxy.constants.ts`。
         */
        allowedHeaders: [
            'Content-Type',
            'Authorization',
            'X-Canvas-Upstream-URL',
            'X-Canvas-Upstream-Format',
            'X-Canvas-Upstream-Key',
            'X-Canvas-Headers',
            'X-Canvas-Scene',
            'X-Idempotency-Key',
        ],
    });
    /*
     * 素材签名校验必须在 useStaticAssets **之前**:
     * 静态中间件命中即响应, 注册在后面等于完全不校验。
     * ASSET_SIGNING_SECRET 为空时该中间件直接放行（保持原有公开行为）。
     */
    app.use((0, signed_asset_middleware_1.createSignedAssetMiddleware)(config.get('asset.signingSecret') ?? ''));
    /*
     * 缩略图中间件同样必须在静态服务之前: 带 `?w=` 的请求若先被静态命中,
     * 拿到的还是原图。未带参数 / 非图片时它直接放行, 回落静态服务。
     */
    app.use((0, asset_thumbnail_middleware_1.createAssetThumbnailMiddleware)(uploadsDir));
    // 静态服务: GET /uploads/* 直接返回图片
    app.useStaticAssets(uploadsDir, { prefix: '/uploads' });
    // 全局参数校验
    app.useGlobalPipes(new common_1.ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: false,
        exceptionFactory: (errors) => new app_exception_1.AppError(40001, flattenValidationErrors(errors), 400),
    }));
    // 统一响应包装与异常处理
    // 异常过滤器已在 AppModule 用 APP_FILTER 注册 (它要注入落盘 logger),
    // 此处不得再 useGlobalFilters —— 并存会导致过滤器执行两次
    app.useGlobalInterceptors(new response_interceptor_1.ResponseInterceptor());
    // Docker/K8s 停止容器时先发 SIGTERM。开启 Nest 关闭钩子，让 Prisma 在退出前
    // 断开 SQLite 连接，避免正在提交的事务被硬中断。
    app.enableShutdownHooks();
    // 端口来自配置层 (PORT, 默认 4100); 监听地址来自 HOST (默认 127.0.0.1)。
    // ⚠ 生产/容器必须 HOST=0.0.0.0: 只绑回环的话容器外根本连不上,
    // 且 compose 里 service 之间的互通同样失败。开发态保持 127.0.0.1 是有意的 ——
    // 不把调试端口暴露到局域网。
    const port = config.get('app.port') ?? 4100;
    const host = config.get('app.host') ?? '127.0.0.1';
    await app.listen(port, host);
    const nodeEnv = config.get('app.env') ?? 'development';
    logger.log(`backend listening on http://${host}:${port} (prefix ${config.get('app.prefix')})`, 'Bootstrap');
    // 环境横幅: 三环境下最常见的乌龙是「以为在test 其实连着开发库」,
    // 所以把生效的环境名与库路径放在启动日志的第一屏。
    logger.log(`运行环境NODE_ENV=${nodeEnv} · 数据库 ${config.get('db.url')} · 上传目录 ${uploadsDir}`, 'Bootstrap');
    // 打印生效的 CORS 来源: CORS 问题的第一现场就是这里, 避免出现"配了但没生效"的盲查
    logger.log(`CORS origins: ${cors.effective.join(', ')}` +
        `${cors.privateLan ? ' + 私有网段(10./172.16-31./192.168.)' : ''}`, 'Bootstrap');
    logger.log(`前端必须用下列任一入口访问: ${cors.effective
        .filter((o) => !o.startsWith('http://192.168'))
        .join(' | ')}`, 'Bootstrap');
    logger.log(`日志落盘: ${logger.logDir || '(不可用, 已降级为仅控制台)'} · LOG_LEVEL=${config.get('log.level')} · 保留 ${config.get('log.retentionDays')} 天`, 'Bootstrap');
    // 安全面横切开关放在启动日志里回显: 「以为开了签名其实没配密钥」是最难查的一类问题
    const rateLimitOn = (process.env.RATE_LIMIT_ENABLED ?? 'true').toLowerCase() !== 'false';
    const signingOn = (config.get('asset.signingSecret') ?? '').trim().length > 0;
    logger.log(`限流 ${rateLimitOn ? '开启' : '已关闭'} · 素材签名 ${signingOn ? '开启(/uploads 需 sig)' : '关闭(公开)'} · 健康检查 /api/v1/health`, 'Bootstrap');
}
void bootstrap().catch((err) => {
    // 启动期失败此前是裸 unhandledRejection。这里显式接管, 保证:
    //   1) 退出码非 0 (start.sh 的 `kill -0` 探测能正确判定失败)
    //   2) 配置校验错误按它自己的多行清单打印, 而不是被压成一行 stack
    const e = err;
    if (e?.name === 'EnvValidationError' && Array.isArray(e.problems)) {
        process.stderr.write(`\n[config] 环境变量校验失败：\n  - ${e.problems.join('\n  - ')}\n\n`);
        process.stderr.write('对照 backend/.env.example 逐项修正后重启。\n\n');
    }
    else {
        process.stderr.write(`\n[bootstrap] 后端启动失败: ${e?.message ?? String(err)}\n`);
        if (err?.stack)
            process.stderr.write(`${err.stack}\n`);
    }
    process.exit(1);
});
//# sourceMappingURL=main.js.map