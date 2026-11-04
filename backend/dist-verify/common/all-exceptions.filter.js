"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AllExceptionsFilter = void 0;
const common_1 = require("@nestjs/common");
const app_exception_1 = require("./app.exception");
const request_context_1 = require("./request-context");
const file_logger_1 = require("./logger/file-logger");
/**
 * 全局异常过滤器: 把任意异常转换为统一格式 { code, data: null, message }
 *
 * 为什么走 DI（原来是在 main.ts 里 `new AllExceptionsFilter()`）
 * ---------------------------------------------------------
 * 它需要 AppFileLogger 才能让异常落盘，而构造注入拿实例是唯一途径。
 * 于是注册方式从 `app.useGlobalFilters()` 改为 AppModule 里的 `APP_FILTER`
 * —— 两者**不能并存**，并存会让过滤器跑两次。
 * ResponseInterceptor 没有 DI 需求，故仍保留 useGlobalInterceptors，不为对齐而改。
 */
let AllExceptionsFilter = class AllExceptionsFilter {
    constructor(logger) {
        this.logger = logger;
    }
    catch(exception, host) {
        const ctx = host.switchToHttp();
        const response = ctx.getResponse();
        const request = ctx.getRequest();
        // requestId 由 requestContextMiddleware 生成, 响应体与日志用同一个值 ——
        // 用户截图里的 id 必须能在日志里 grep 到这一条
        const requestId = (0, request_context_1.currentRequestId)();
        // 不要再往消息里拼 [rid=...]：AppFileLogger.emit 已经按请求上下文统一加前缀，
        // 两处都加会落成 `[rid=x] [AllExceptionsFilter] [rid=x] [...]`，grep 时噪声翻倍
        let code = 50001;
        let message = 'Internal server error';
        let status = common_1.HttpStatus.INTERNAL_SERVER_ERROR;
        if (exception instanceof app_exception_1.AppError) {
            code = exception.code;
            message = exception.message;
            status = exception.getStatus();
        }
        else if (exception instanceof common_1.HttpException) {
            status = exception.getStatus();
            const body = exception.getResponse();
            message = extractMessage(body);
            code = mapHttpStatusToCode(status);
            // HttpException 也可能是底层错误被 Nest 包装的, 记录原始信息便于诊断
            this.logger.error(`[HttpException] ${status} ${exception.message}`, exception.stack?.split('\n').slice(1, 4).join('\n'), 'AllExceptionsFilter');
        }
        else {
            // 未知异常: 记录日志(整条落盘), 不向客户端暴露细节
            this.logger.error(`[UnhandledException] ${exception?.message ?? String(exception)}`, exception?.stack ?? '', 'AllExceptionsFilter');
        }
        // 5xx 才外发告警: 4xx 是用户输入问题, 打给值班群里只会淹没真正的故障
        if (status >= 500) {
            void notifyErrorWebhook({
                requestId,
                status,
                code,
                message,
                path: request?.originalUrl,
                method: request?.method,
                stack: exception?.stack?.split('\n').slice(0, 8).join('\n'),
            });
        }
        response.status(status).json({ code, data: null, message, requestId: requestId ?? null });
    }
};
exports.AllExceptionsFilter = AllExceptionsFilter;
exports.AllExceptionsFilter = AllExceptionsFilter = __decorate([
    (0, common_1.Injectable)(),
    (0, common_1.Catch)(),
    __metadata("design:paramtypes", [file_logger_1.AppFileLogger])
], AllExceptionsFilter);
/**
 * 未处理异常外发（可选, ERROR_WEBHOOK_URL 为空则不做事）。
 *
 * 只发**摘要**: 完整堆栈里可能夹带凭据与用户数据, 外发前不做脱敏就是
 * 一次数据出境。这里只带 message 与堆栈前 8 行, 且整体 3s 超时 ——
 * 告警链路绝不能反过来拖住错误响应。
 */
async function notifyErrorWebhook(payload) {
    const url = (process.env.ERROR_WEBHOOK_URL ?? '').trim();
    if (!url)
        return;
    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 3000);
        await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ service: 'huojue-ai', at: new Date().toISOString(), ...payload }),
            signal: controller.signal,
        });
        clearTimeout(timer);
    }
    catch {
        // 告警失败只能咽下: 再抛异常就变成"错误处理里的错误"
    }
}
function extractMessage(body) {
    if (typeof body === 'string')
        return body;
    if (body && typeof body === 'object') {
        const maybe = body;
        if (typeof maybe.message === 'string')
            return maybe.message;
        if (Array.isArray(maybe.message))
            return String(maybe.message[0]);
    }
    return '请求处理失败';
}
function mapHttpStatusToCode(status) {
    switch (status) {
        case 401:
            return 40101;
        case 403:
            return 40001;
        case 404:
            return 40001;
        case 422:
            return 42201;
        case 400:
            return 40001;
        default:
            return 50001;
    }
}
//# sourceMappingURL=all-exceptions.filter.js.map