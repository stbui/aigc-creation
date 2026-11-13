import { describe, expect, it, vi } from 'vitest';

import { OutboundError } from '../infra/outbound';
import {
  type CallLogInput,
  failureCodeOf,
  safeFailure,
  TaskExecutorService,
} from './task-executor.service';

function input(overrides: Partial<CallLogInput> = {}): CallLogInput {
  return {
    userId: 'user-1',
    taskId: 'task-1',
    billingOrderId: 'order-1',
    channel: {
      channelId: 'channel-1',
      channelName: '测试渠道',
      channelModelId: 'channel-model-1',
      modelKey: 'video-model',
      providerModelKey: 'video-model',
      capability: 'video',
      protocol: 'minimax-video',
      concurrencyLimit: 2,
    } as never,
    operation: 'image_to_video',
    requestKind: 'poll',
    billable: true,
    spec: { method: 'GET', path: '/v2/query/video_generation/job-1', contentType: '' },
    method: 'GET',
    path: '/v2/query/video_generation/job-1',
    outcome: {
      status: 'succeeded',
      providerStatus: 'succeeded',
      providerRequestId: 'job-1',
      result: { videos: [{ url: 'https://example.test/result.mp4' }] },
      stage: '',
      message: '',
      failureCode: '',
      failureMessage: '',
      rejectedNoJob: false,
      statusCode: 200,
      durationMs: 25,
      latencyMs: 25,
    },
    pollCount: 1,
    requestBody: '',
    responseBody: '{"status":"succeeded"}',
    upstreamUrl: 'https://example.test/v2/query/video_generation/job-1',
    videoSeconds: 6,
    ...overrides,
  };
}

describe('TaskExecutorService.logCall', () => {
  it('轮询 GET 没有请求体时仍使用业务时长写日志', async () => {
    const create = vi.fn().mockResolvedValue({});
    const service = new TaskExecutorService({ apiCallLog: { create } } as never, {} as never);

    await service.logCall(input());

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        requestKind: 'poll',
        mediaCount: 1,
        videoSeconds: 6,
        requestBody: '',
      }),
    });
  });

  it('显式时长优先于请求体推断值', async () => {
    const create = vi.fn().mockResolvedValue({});
    const service = new TaskExecutorService({ apiCallLog: { create } } as never, {} as never);

    await service.logCall(input({ requestBody: '{"duration":10}', videoSeconds: 6 }));

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({ videoSeconds: 6 }),
    });
  });
});

describe('create 请求构建失败', () => {
  it('buildCreate 抛错时请求未发出，按「上游明确没接」处理', async () => {
    const buildCreate = vi.fn().mockRejectedValue(new Error('协议参数缺失'));
    const send = vi.fn();
    const service = new TaskExecutorService({} as never, { send } as never);

    const result = await service.create(
      { buildCreate } as never,
      {
        runtime: { baseUrl: 'https://example.test' },
        channelId: 'channel-1',
        concurrencyLimit: 0,
      } as never,
      { capability: 'image', operation: 'text_to_image', prompt: '测试' } as never,
    );

    expect(result.outcome.failureCode).toBe('request_invalid');
    expect(result.outcome.rejectedNoJob).toBe(true);
    expect(send).not.toHaveBeenCalled();
  });
});

describe('上游网络失败分类', () => {
  it('连接被拒绝说明请求没有到达上游，应允许安全换线或自动退款', () => {
    const failureCode = failureCodeOf(
      new OutboundError('外部服务请求失败：connect ECONNREFUSED 127.0.0.1:3900', 'network'),
    );

    expect(failureCode).toBe('outbound_connection_refused');
    expect(safeFailure(failureCode)).toBe(true);
  });

  it('连接建立后中断仍属于结果不明，不能自动重发', () => {
    const failureCode = failureCodeOf(
      new OutboundError('外部服务请求失败：read ECONNRESET', 'network'),
    );

    expect(failureCode).toBe('outbound_network');
    expect(safeFailure(failureCode)).toBe(false);
  });
});
