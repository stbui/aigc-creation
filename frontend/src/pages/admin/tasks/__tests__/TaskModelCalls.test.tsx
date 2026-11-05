import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiLogListResult, ApiLogView } from '../../../../types/model';

const { listMock } = vi.hoisted(() => ({ listMock: vi.fn() }));

vi.mock('../api', () => ({
  adminApiLogsApi: { list: listMock },
}));

import { TaskModelCalls } from '../TaskModelCalls';

function apiLog(overrides: Partial<ApiLogView> = {}): ApiLogView {
  return {
    id: 'log-1',
    userId: 'user-1',
    traceId: 'trace-1',
    requestId: 'request-1',
    channelId: 'channel-1',
    channelName: '渠道 A',
    taskId: 'task-1',
    billingOrderId: '',
    source: 'task',
    capability: 'main_image',
    operation: 'generate',
    requestKind: 'create',
    billable: true,
    apiFormat: 'openai.images',
    method: 'POST',
    path: '/images/generations',
    model: 'seedream-4.0',
    status: 'success',
    statusCode: 200,
    durationMs: 1200,
    pollCount: 0,
    providerStatus: 'succeeded',
    inputTokens: 0,
    outputTokens: 0,
    cachedTokens: 0,
    usageAvailable: false,
    mediaCount: 1,
    videoSeconds: 0,
    providerRequestId: 'provider-request-1',
    errorCode: '',
    error: '',
    createdAt: '2026-11-05T10:00:00.000Z',
    ...overrides,
  };
}

function renderCalls(canRead: boolean) {
  return render(
    <MemoryRouter>
      <TaskModelCalls taskId="task-1" canRead={canRead} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  listMock.mockReset();
});

describe('TaskModelCalls', () => {
  it('无权限时不渲染区块且不请求调用记录', () => {
    renderCalls(false);

    expect(screen.queryByText('模型调用')).not.toBeInTheDocument();
    expect(listMock).not.toHaveBeenCalled();
  });

  it('按当前任务请求最近调用并展示摘要、渠道、模型与错误', async () => {
    const result: ApiLogListResult = {
      items: [
        apiLog(),
        apiLog({
          id: 'log-2',
          channelName: '渠道 B',
          model: 'flux-pro',
          requestKind: 'poll',
          status: 'failed',
          statusCode: 500,
          durationMs: 300,
          pollCount: 2,
          errorCode: 'UPSTREAM_500',
          error: '上游返回 500',
        }),
      ],
      total: 3,
      page: 1,
      pageSize: 20,
      summary: { total: 3, success: 2, failed: 1, other: 0, avgDurationMs: 750 },
    };
    listMock.mockResolvedValue(result);

    renderCalls(true);

    expect(await screen.findByText('渠道 A')).toBeInTheDocument();
    expect(listMock).toHaveBeenCalledWith({ taskId: 'task-1', page: 1, pageSize: 20 });
    expect(screen.getByText(/共 3 次 · 成功 2 · 失败\/取消 1/)).toBeInTheDocument();
    expect(screen.getByText('渠道 B')).toBeInTheDocument();
    expect(screen.getByText('flux-pro')).toBeInTheDocument();
    expect(screen.getByText('UPSTREAM_500')).toBeInTheDocument();
    expect(screen.getByText('上游返回 500')).toBeInTheDocument();
    expect(screen.getByText('成功')).toBeInTheDocument();
    expect(screen.getByText('失败')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /查看全部调用/ })).toHaveAttribute(
      'href',
      '/admin/model-calls?taskId=task-1',
    );
  });

  it('无调用时显示该任务的空态', async () => {
    listMock.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
      summary: { total: 0, success: 0, failed: 0, other: 0, avgDurationMs: 0 },
    } satisfies ApiLogListResult);

    renderCalls(true);

    expect(await screen.findByText('该任务尚无上游调用')).toBeInTheDocument();
  });
});
