import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Response } from 'express';
import { AppError } from './app.exception';
import { AppFileLogger } from './logger/file-logger';

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
@Injectable()
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(private readonly logger: AppFileLogger) {}
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    let code = 50001;
    let message = 'Internal server error';
    let status = HttpStatus.INTERNAL_SERVER_ERROR;

    if (exception instanceof AppError) {
      code = exception.code;
      message = exception.message;
      status = exception.getStatus();
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      message = extractMessage(body);
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

    response.status(status).json({ code, data: null, message });
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
    case 422:
      return 42201;
    case 400:
      return 40001;
    default:
      return 50001;
  }
}
