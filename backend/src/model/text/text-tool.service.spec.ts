import { describe, expect, it, vi } from 'vitest';
import { requestContextMiddleware } from '../../common/request-context';
import { TextToolService } from './text-tool.service';

describe('TextToolService 用户提示', () => {
  it('没有可用文字线路时不暴露内部配置用语', async () => {
    const prisma = {
      channelModel: { findMany: vi.fn().mockResolvedValue([]) },
      modelChannel: { findMany: vi.fn() },
    };
    const service = new TextToolService(prisma as never, {} as never, {} as never);

    const error = await service
      .generate({ operation: 'prompt_polish', instructions: '润色提示词' })
      .then(
        () => null,
        (caught: unknown) => caught as Error,
      );

    expect(error).toBeInstanceOf(Error);
    expect(error?.message).toBe('文字处理暂时不可用，请稍后再试');
    expect(error?.message).not.toMatch(/text|渠道|模型|配置/i);
  });

  it('调用记录写入当前请求号，便于从用户报障反查上游调用', async () => {
    const prisma = {
      channelModel: {
        findMany: vi.fn().mockResolvedValue([{ id: 'cm-1', channelId: 'ch-1', sortOrder: 0 }]),
      },
      modelChannel: {
        findMany: vi.fn().mockResolvedValue([{ id: 'ch-1', sortOrder: 0 }]),
      },
      apiCallLog: { create: vi.fn().mockResolvedValue({}) },
    };
    const channels = {
      prepare: vi.fn().mockResolvedValue({
        channelId: 'ch-1',
        channelName: '识图渠道',
        channelModelId: 'cm-1',
        modelKey: 'vision-model',
        providerModelKey: 'vision-model',
        capability: 'text',
        protocol: 'openai.chat',
        concurrencyLimit: 0,
        adapter: {
          buildCreate: vi.fn().mockResolvedValue({
            method: 'POST',
            path: '/chat/completions',
            contentType: 'application/json',
          }),
          parseCreate: vi.fn().mockResolvedValue({
            status: 'succeeded',
            result: { text: '一张白色背景上的商品图' },
          }),
        },
        runtime: {
          baseUrl: 'https://example.invalid',
          credentials: { apiKey: '' },
        },
      }),
    };
    const executor = {
      send: vi.fn().mockResolvedValue({
        status: 200,
        headers: {},
        body: Buffer.from('{}'),
        text: '{}',
        url: 'https://example.invalid/chat/completions',
        durationMs: 10,
      }),
    };
    const service = new TextToolService(prisma as never, channels as never, executor as never);
    const request = { headers: { 'x-request-id': 'req-abc123' }, method: 'POST', originalUrl: '/api/v1/prompt-tools/image-to-prompt' };
    const response = { setHeader: vi.fn() };

    await new Promise<void>((resolve, reject) => {
      requestContextMiddleware(request as never, response as never, () => {
        void service
          .generate({ operation: 'image_to_prompt', instructions: '分析图片', userId: 'user-1' })
          .then(() => resolve(), reject);
      });
    });

    expect(prisma.apiCallLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ requestId: 'req-abc123', operation: 'image_to_prompt' }),
    });
  });
});
