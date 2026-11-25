import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfigValues } from '../config/env.validation';
import type { Request, Response } from 'express';
import { AppError } from './app.exception';
import { currentRequestId } from './request-context';
import { AppFileLogger } from './logger/file-logger';

/**
 * 上传超限（HTTP 413）的业务码与文案。
 *
 * 上传链路的 413 只有 multer 一个来源（`FileInterceptor` 抛 `LIMIT_FILE_SIZE`，
 * 经官方 `transformException` 转成 `PayloadTooLargeException`），其默认 message 是
 * multer 内置英文 `File too large`，直接透出等于把内部实现细节给了用户。
 *
 * 文案不写死具体 MB 数：各路由的 `limits.fileSize` 不同（素材 / 手机上传是部署硬
 * 上限，对账单与插件包另有更小的上限），真实生效值由前端按 `GET /settings` 的
 * `upload.maxBytes` 提示，服务端只陈述事实。
 */
const UPLOAD_TOO_LARGE_CODE = 41301;
const UPLOAD_TOO_LARGE_COPY = '文件超过单次上传上限，本次未上传，请压缩或改传较小的文件后重试';

/**
 * 全局异常过滤器: 把任意异常转换为统一格式 { code, data: null, message }
 *
 * 为什么走 DI（原来是在 main.ts 里 `new AllExceptionsFilter()`）
 * ---------------------------------------------------------
 * 它需要 AppFileLogger 才能让异常落盘，而构造注入拿实例是唯一途径。
 * 于是注册方式从 `app.useGlobalFilters()` 改为 AppModule 里的 `APP_FILTER`
 * —— 两者**不能并存**，并存会让过滤器跑两次。
 * 全局管道、拦截器与过滤器现在统一使用 APP_* 令牌注册，避免 main.ts
 * 与测试装配各自维护一份配置。
 */
@Injectable()
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(
    private readonly logger: AppFileLogger,
    private readonly config: ConfigService<AppConfigValues, true>,
  ) {}
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    // requestId 由 requestContextMiddleware 生成, 响应体与日志用同一个值 ——
    // 用户截图里的 id 必须能在日志里 grep 到这一条
    const requestId = currentRequestId();
    // 不要再往消息里拼 [rid=...]：AppFileLogger.emit 已经按请求上下文统一加前缀，
    // 两处都加会落成 `[rid=x] [AllExceptionsFilter] [rid=x] [...]`，grep 时噪声翻倍

    let code = 50001;
    let message = 'Internal server error';
    let status = HttpStatus.INTERNAL_SERVER_ERROR;

    if (exception instanceof AppError) {
      code = exception.code;
      message = exception.message;
      status = exception.getStatus();
      /*
       * 业务 5xx（支付不可用、结果不明、模型链路全失败等）必须落盘。
       *
       * 响应体已经带 `requestId`，但此前 AppError 走的是不记录日志的分支 ——
       * 用户截图里的请求号在日志里 grep 不到任何一行，等于没有可追溯线索。
       * 4xx 是输入/状态问题，量大且无需追责，保持安静。
       */
      if (status >= 500) {
        this.logger.error(
          `[AppError ${code}] ${status} ${message}`,
          (exception as Error).stack?.split('\n').slice(1, 4).join('\n'),
          'AllExceptionsFilter',
        );
      }
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      /*
       * multer 抛出的超限错误由 Nest 官方 `transformException` 转成
       * `PayloadTooLargeException`，其 message 是 multer 内置的英文 `File too large`。
       * 能进到本过滤器的 413 只有这一个来源：业务侧的请求体超限一律走 `AppError`
       * （中转路径用 `@Res()` 直写响应，根本不经过过滤器）。故**按状态码**判定，
       * 不按 message 文本匹配 —— 文案会变，状态码不会。
       * 上传超限是用户可处置的输入问题，改成中文文案并落到 413xx 码段。
       */
      message =
        status === HttpStatus.PAYLOAD_TOO_LARGE ? UPLOAD_TOO_LARGE_COPY : extractMessage(body);
      code = mapHttpStatusToCode(status);
      // HttpException 也可能是底层错误被 Nest 包装的, 记录原始信息便于诊断
      this.logger.error(
        `[HttpException] ${status} ${(exception as Error).message}`,
        (exception as Error).stack?.split('\n').slice(1, 4).join('\n'),
        'AllExceptionsFilter',
      );
    } else {
      // 未知异常: 记录日志(整条落盘), 不向客户端暴露细节
      this.logger.error(
        `[UnhandledException] ${(exception as Error)?.message ?? String(exception)}`,
        (exception as Error)?.stack ?? '',
        'AllExceptionsFilter',
      );
    }

    // 5xx 才外发告警: 4xx 是用户输入问题, 打给值班群里只会淹没真正的故障
    if (status >= 500) {
      void this.notifyErrorWebhook({
        requestId,
        status,
        code,
        message,
        path: request?.originalUrl,
        method: request?.method,
        stack: (exception as Error)?.stack?.split('\n').slice(0, 8).join('\n'),
      });
    }

    response.status(status).json({ code, data: null, message, requestId: requestId ?? null });
  }

  /**
   * 未处理异常外发（可选, ERROR_WEBHOOK_URL 为空则不做事）。
   *
   * 只发**摘要**: 完整堆栈里可能夹带凭据与用户数据, 外发前不做脱敏就是
   * 一次数据出境。这里只带 message 与堆栈前 8 行, 且整体 3s 超时 ——
   * 告警链路绝不能反过来拖住错误响应。
   */
  private async notifyErrorWebhook(payload: Record<string, unknown>): Promise<void> {
    const url = (this.config.get<string>('observability.errorWebhookUrl') ?? '').trim();
    if (!url) return;
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
    } catch {
      // 告警失败只能咽下: 再抛异常就变成"错误处理里的错误"
    }
  }
}

function extractMessage(body: unknown): string {
  if (typeof body === 'string') return body;
  if (body && typeof body === 'object') {
    const maybe = body as Record<string, unknown>;
    if (typeof maybe.message === 'string') return maybe.message;
    if (Array.isArray(maybe.message)) return String(maybe.message[0]);
  }
  return '请求处理失败';
}

function mapHttpStatusToCode(status: number): number {
  switch (status) {
    case 401:
      return 40101;
    case 403:
      return 40001;
    case 404:
      return 40001;
    case 413:
      return UPLOAD_TOO_LARGE_CODE;
    case 422:
      return 42201;
    case 400:
      return 40001;
    default:
      return 50001;
  }
}
