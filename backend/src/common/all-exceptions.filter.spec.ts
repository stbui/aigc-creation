import { ArgumentsHost, BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { AllExceptionsFilter } from './all-exceptions.filter';
import { AppError } from './app.exception';

type FilterDeps = ConstructorParameters<typeof AllExceptionsFilter>;

/** 空 webhook → 5xx 外发直接短路，测试不发真实请求 */
function buildFilter() {
  const logger = { error: vi.fn() };
  const config = { get: () => '' };
  return {
    logger,
    filter: new AllExceptionsFilter(
      logger as unknown as FilterDeps[0],
      config as unknown as FilterDeps[1],
    ),
  };
}

interface Harness {
  filter: AllExceptionsFilter;
  host: ArgumentsHost;
  captured: { status: number; body: Record<string, unknown> };
  logger: { error: ReturnType<typeof vi.fn> };
}

function build(): Harness {
  const captured = { status: 0, body: {} as Record<string, unknown> };
  const response = {
    status(code: number) {
      captured.status = code;
      return this;
    },
    json(body: Record<string, unknown>) {
      captured.body = body;
      return this;
    },
  };
  const host = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => ({ originalUrl: '/api/v1/assets/upload', method: 'POST' }),
    }),
  } as unknown as ArgumentsHost;
  const { filter, logger } = buildFilter();
  return { filter, host, captured, logger };
}

describe('AllExceptionsFilter', () => {
  it('multer 413 落到 41301 并改写为中文文案，不透出 multer 内置英文', () => {
    const { filter, host, captured } = build();

    filter.catch(new PayloadTooLargeException('File too large'), host);

    expect(captured.status).toBe(413);
    expect(captured.body).toMatchObject({
      code: 41301,
      data: null,
      message: '文件超过单次上传上限，本次未上传，请压缩或改传较小的文件后重试',
    });
    expect(JSON.stringify(captured.body)).not.toContain('File too large');
  });

  it('非 413 的 HttpException 文案原样透出，不被上传文案污染', () => {
    const { filter, host, captured } = build();

    filter.catch(new BadRequestException('标题不能为空'), host);

    expect(captured.status).toBe(400);
    expect(captured.body).toMatchObject({ code: 40001, message: '标题不能为空' });
  });

  it('AppError 保留自身业务码与文案', () => {
    const { filter, host, captured } = build();

    filter.catch(new AppError(40905, '超出可退时间窗，请走人工退款', 409), host);

    expect(captured.status).toBe(409);
    expect(captured.body).toMatchObject({ code: 40905, message: '超出可退时间窗，请走人工退款' });
  });

  it('未知异常不外泄细节，固定 50001 并落盘', () => {
    const { filter, host, captured, logger } = build();

    filter.catch(new Error('ECONNREFUSED /var/run/db.sock'), host);

    expect(captured.status).toBe(500);
    expect(captured.body).toMatchObject({ code: 50001, message: 'Internal server error' });
    expect(JSON.stringify(captured.body)).not.toContain('db.sock');
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  /*
   * 真链路：multer 自己抛 LIMIT_FILE_SIZE → 官方 transformException 转成
   * PayloadTooLargeException → 本过滤器出信封。
   *
   * 上面几条按「已知的官方产出」构造异常；只这样断言会让「Nest 是否真的这样转」
   * 成为隐含假设 —— 上游映射一改，单测仍全绿，用户却看到英文。
   *
   * 这里直接 new 官方 FileInterceptor 的 mixin 实例并喂真实 multipart 流，
   * 因此不需要数据库 / Redis，也不依赖 AppModule（spec 文件里不能写装饰器：
   * tsconfig 排除 *.spec.ts，rolldown 不解析其中的装饰器语法）。
   */
  describe('真实 multer 拦截器链路', () => {
    function buildUploadApp() {
      const Interceptor = FileInterceptor('file', {
        limits: { fileSize: 10, files: 1 },
      }) as unknown as new () => {
        intercept: (
          ctx: unknown,
          next: { handle: () => { subscribe: (s: { next: (v: unknown) => void }) => void } },
        ) => Promise<unknown>;
      };
      const interceptor = new Interceptor();
      const { filter } = buildFilter();
      const app = express();

      app.post('/upload', (req: express.Request, res: express.Response) => {
        const host = {
          switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
        } as unknown as ArgumentsHost;
        void interceptor
          .intercept(host, {
            // 拦截器只做「跑完 multer」这件事；本用例读的是 req.file，不消费它的返回值
            handle: () => ({
              subscribe: (sink: { next: (v: unknown) => void }) => sink.next(null),
            }),
          })
          .then(() => {
            const size = (req as unknown as { file?: { size?: number } }).file?.size ?? null;
            res.status(201).json({ size });
          })
          .catch((error: unknown) => filter.catch(error, host));
      });

      return app;
    }

    it('超限文件被 multer 截断后返回 41301 中文文案', async () => {
      const res = await request(buildUploadApp())
        .post('/upload')
        .attach('file', Buffer.alloc(2048), 'big.bin')
        .timeout(5000);

      expect(res.status).toBe(413);
      expect(res.body).toMatchObject({
        code: 41301,
        data: null,
        message: '文件超过单次上传上限，本次未上传，请压缩或改传较小的文件后重试',
      });
      expect(JSON.stringify(res.body)).not.toMatch(/File too large|Payload Too Large/i);
    });

    it('未超限的上传不受影响（映射没有误伤正常路径）', async () => {
      const res = await request(buildUploadApp())
        .post('/upload')
        .attach('file', Buffer.alloc(4), 'ok.bin')
        .timeout(5000);

      expect(res.status).toBe(201);
      expect(res.body).toEqual({ size: 4 });
    });
  });
});
