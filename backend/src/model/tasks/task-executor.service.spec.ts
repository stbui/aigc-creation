import { describe, expect, it, vi } from 'vitest';

import { TaskExecutorService, type CallLogInput } from './task-executor.service';

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
