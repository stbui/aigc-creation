import { act, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BatchSummary } from '../../../../types/api';
import { ToastProvider } from '../../../../admin-ui/providers/ToastProvider';
import type { AdminTaskRow } from '../types';

const { batchMock, removeMock, reloadMock } = vi.hoisted(() => ({
  batchMock: vi.fn(),
  removeMock: vi.fn(),
  reloadMock: vi.fn(),
}));

vi.mock('../api', () => ({
  adminTasksApi: {
    retry: vi.fn(),
    cancel: vi.fn(),
    remove: removeMock,
    batch: batchMock,
  },
}));

import { useTaskActions } from '../useTaskActions';

const TASK: AdminTaskRow = {
  id: 'task-1',
  capability: 'main_image',
  capabilityName: '主图生成',
  status: 'failed',
  provider: 'gateway',
  errorCode: 'MODEL_ERROR',
  creditCost: 10,
  retriedFromId: null,
  user: { id: 'user-1', email: 'user@example.com' },
  project: { id: 'project-1', name: '项目一' },
  durationMs: 1500,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:01.500Z',
  thumbnailUrl: null,
};

const BATCH_SUMMARY: BatchSummary<unknown> = {
  total: 2,
  succeeded: 1,
  failed: 1,
  results: [
    { id: 'task-1', ok: true },
    { id: 'task-2', ok: false, message: '状态不允许' },
  ],
};

function TestWrapper({ children }: PropsWithChildren) {
  return <ToastProvider>{children}</ToastProvider>;
}

function renderActions() {
  const onSelectionChange = vi.fn();
  const onDeleted = vi.fn();
  const reload = vi.fn();
  const hook = renderHook(
    () =>
      useTaskActions({
        reload,
        onDeleted,
        selected: ['task-1', 'task-2'],
        onSelectionChange,
      }),
    { wrapper: TestWrapper },
  );

  return { ...hook, onSelectionChange, onDeleted, reload };
}

beforeEach(() => {
  batchMock.mockReset();
  removeMock.mockReset();
  reloadMock.mockReset();
});

describe('useTaskActions', () => {
  it('批量操作成功后清空选中、刷新列表并展示逐条结果', async () => {
    let resolveBatch: ((value: BatchSummary<unknown>) => void) | undefined;
    batchMock.mockImplementation(
      () =>
        new Promise<BatchSummary<unknown>>((resolve) => {
          resolveBatch = resolve;
        }),
    );
    const { result, onSelectionChange, reload } = renderActions();

    act(() => result.current.openBatch('delete'));
    let firstRun: Promise<void> | undefined;
    act(() => {
      firstRun = result.current.runBatch('delete');
      void result.current.runBatch('delete');
    });

    expect(batchMock).toHaveBeenCalledTimes(1);
    expect(batchMock).toHaveBeenCalledWith(['task-1', 'task-2'], 'delete');

    await act(async () => {
      resolveBatch?.(BATCH_SUMMARY);
      await firstRun;
    });

    expect(onSelectionChange).toHaveBeenCalledWith([]);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(result.current.batchKind).toBeNull();
    expect(result.current.batchSummary).toEqual(BATCH_SUMMARY);
    expect(result.current.batchTitle).toBe('批量删除结果');
    expect(result.current.busy).toBe(false);
  });

  it('批量操作失败时保留选中与列表，并释放提交锁', async () => {
    batchMock.mockRejectedValue(new Error('后端拒绝'));
    const { result, onSelectionChange, reload } = renderActions();

    await act(async () => {
      await result.current.runBatch('retry');
    });

    expect(onSelectionChange).not.toHaveBeenCalledWith([]);
    expect(reload).not.toHaveBeenCalled();
    expect(result.current.busy).toBe(false);
    await waitFor(() => expect(result.current.batchSummary).toBeNull());
  });

  it('单条删除成功后关闭详情并刷新列表', async () => {
    removeMock.mockResolvedValue({ id: TASK.id, removedAsset: true });
    const { result, onDeleted, reload } = renderActions();

    act(() => result.current.openConfirm('delete', TASK));
    expect(result.current.confirm).toEqual({ kind: 'delete', task: TASK });

    await act(async () => {
      await result.current.runConfirm();
    });

    expect(removeMock).toHaveBeenCalledWith(TASK.id);
    expect(onDeleted).toHaveBeenCalledTimes(1);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(result.current.confirm).toBeNull();
    expect(result.current.busy).toBe(false);
  });
});
