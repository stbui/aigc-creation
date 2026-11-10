import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiLogListResult, ApiLogView } from '../../../../types/model';

const { listMock } = vi.hoisted(() => ({
  listMock: vi.fn(),
}));

vi.mock('../api', () => ({
  adminApiLogsApi: { list: listMock },
}));

import { AiAnalysisMonitor } from '../AiAnalysisMonitor';

function logRow(overrides: Partial<ApiLogView> = {}): ApiLogView {
  return {
    id: 'log-1',
    userId: 'user-1',
    traceId: 'trace-1',
    requestId: 'req-abc123',
    channelId: 'channel-1',
    channelName: '视觉分析线路',
    taskId: '',
    billingOrderId: '',
    source: 'tool',
    capability: 'text',
    operation: 'image_to_prompt',
    requestKind: 'create',
    billable: false,
    apiFormat: 'openai.chat',
    method: 'POST',
    path: '/chat/completions',
    model: 'vision-model',
    status: 'success',
    statusCode: 200,
    durationMs: 1250,
    pollCount: 0,
    providerStatus: '',
    inputTokens: 640,
    outputTokens: 96,
    cachedTokens: 0,
    usageAvailable: true,
    mediaCount: 0,
    videoSeconds: 0,
    providerRequestId: 'provider-1',
    errorCode: '',
    error: '',
    createdAt: '2026-11-10T02:00:00.000Z',
    userDisplayName: '运营用户',
    userAccount: 'user@example.com',
    ...overrides,
  };
}

function listResult(items: ApiLogView[]): ApiLogListResult {
  return {
    items,
    total: items.length,
    page: 1,
    pageSize: 20,
    summary: {
      total: items.length,
      success: items.filter((item) => item.status === 'success').length,
      failed: items.filter((item) => item.status === 'failed' || item.status === 'canceled').length,
      other: 0,
      avgDurationMs: items.length > 0 ? 1250 : 0,
    },
  };
}

function renderMonitor(path = '/admin/tasks?tab=ai-analysis') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AiAnalysisMonitor />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  listMock.mockReset();
});

describe('AiAnalysisMonitor', () => {
  it('只查询 AI 分析来源与操作，并从地址栏恢复筛选', async () => {
    listMock.mockResolvedValue(listResult([logRow()]));

    renderMonitor('/admin/tasks?tab=ai-analysis&aiStatus=failed&aiUserId=user-1');

    await waitFor(() => {
      expect(listMock).toHaveBeenCalledWith({
        source: 'tool',
        operation: 'image_to_prompt',
        status: 'failed',
        userId: 'user-1',
        from: '',
        to: '',
        page: 1,
        pageSize: 20,
      });
    });
  });

  it('展示用户、模型、Token 用量和请求号，并链接到完整调用记录', async () => {
    listMock.mockResolvedValue(listResult([logRow()]));

    renderMonitor();

    expect(await screen.findByText('运营用户')).toBeInTheDocument();
    expect(screen.getByText('视觉分析线路')).toBeInTheDocument();
    expect(screen.getByText('vision-model')).toBeInTheDocument();
    expect(screen.getByText('输入 640')).toBeInTheDocument();
    expect(screen.getByText('req-abc123')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'user@example.com' })).toHaveAttribute(
      'href',
      '/admin/users?id=user-1',
    );
    expect(screen.getByRole('link', { name: /完整调用记录/ })).toHaveAttribute(
      'href',
      '/admin/model-calls?source=tool&operation=image_to_prompt',
    );
  });
});
