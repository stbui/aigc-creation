import { act, renderHook, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { PropsWithChildren } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AdminTaskListResult } from '../../../../types/api';
import { ToastProvider } from '../../../../admin-ui/providers/ToastProvider';

const { listMock, exportCsvMock } = vi.hoisted(() => ({
  listMock: vi.fn(),
  exportCsvMock: vi.fn(),
}));

vi.mock('../api', () => ({
  adminTasksApi: {
    list: listMock,
    exportCsv: exportCsvMock,
  },
}));

import { useTaskFilters } from '../useTaskFilters';

const EMPTY_RESULT: AdminTaskListResult = {
  result: { items: [], total: 0, page: 1, pageSize: 20 },
  congestion: { queued: 0, running: 0, failedLastHour: 0, runningThreshold: 50 },
  capabilities: [],
  failureGroups: [],
};

function TestWrapper({ children }: PropsWithChildren) {
  return (
    <MemoryRouter initialEntries={['/admin/tasks']}>
      <ToastProvider>{children}</ToastProvider>
    </MemoryRouter>
  );
}

beforeEach(() => {
  listMock.mockReset();
  exportCsvMock.mockReset();
  listMock.mockResolvedValue(EMPTY_RESULT);
  exportCsvMock.mockResolvedValue(undefined);
  window.history.replaceState({}, '', '/admin/tasks');
});

describe('useTaskFilters', () => {
  it('草稿修改不请求；查询后使用新条件，且 hasFilter 只跟随已生效查询', async () => {
    const onQueryChange = vi.fn();
    const { result } = renderHook(() => useTaskFilters({ onQueryChange }), {
      wrapper: TestWrapper,
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(listMock).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.setStatus('failed');
      result.current.setCapability('main_image');
      result.current.setProject('project-1');
    });

    expect(result.current.hasFilter).toBe(false);
    expect(listMock).toHaveBeenCalledTimes(1);

    act(() => result.current.applyFilters());

    await waitFor(() => expect(listMock).toHaveBeenCalledTimes(2));
    expect(onQueryChange).toHaveBeenCalledTimes(1);
    expect(result.current.hasFilter).toBe(true);
    expect(listMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        page: 1,
        pageSize: 20,
        status: 'failed',
        capability: 'main_image',
        projectId: 'project-1',
      }),
    );
  });

  it('导出使用已生效条件，不受尚未提交的输入草稿影响', async () => {
    const { result } = renderHook(() => useTaskFilters(), { wrapper: TestWrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.setStatus('failed');
      result.current.setOwner('user-applied');
      result.current.setFrom('2026-01-01T00:00');
    });
    act(() => result.current.applyFilters());
    await waitFor(() => expect(listMock).toHaveBeenCalledTimes(2));

    act(() => result.current.setOwner('user-draft'));
    await act(async () => {
      await result.current.exportTasks();
    });

    expect(exportCsvMock).toHaveBeenCalledWith({
      status: 'failed',
      capability: undefined,
      userId: 'user-applied',
      projectId: undefined,
      from: '2026-01-01T00:00',
      to: undefined,
    });
  });

  it('已生效筛选不跟草稿变化，应用视图后草稿、已生效筛选与回显同步', async () => {
    const { result } = renderHook(() => useTaskFilters(), { wrapper: TestWrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.setStatus('failed'));
    expect(result.current.appliedFilters.status).toBeUndefined();
    expect(result.current.draftFilters.status).toBe('failed');
    expect(result.current.hasFilter).toBe(false);

    act(() => result.current.applyView({ status: 'running' }));
    await waitFor(() => expect(listMock).toHaveBeenCalledTimes(2));

    expect(result.current.appliedFilters.status).toBe('running');
    expect(result.current.draftFilters.status).toBe('running');
    expect(result.current.hasFilter).toBe(true);
    expect(result.current.appliedChips).toEqual(
      expect.arrayContaining([expect.objectContaining({ key: 'status', label: '状态：执行中' })]),
    );
  });

  it('深链筛选会进入首次请求', async () => {
    function DeepLinkWrapper({ children }: PropsWithChildren) {
      return (
        <MemoryRouter
          initialEntries={['/admin/tasks?status=running&projectId=project-2&capability=video']}
        >
          <ToastProvider>{children}</ToastProvider>
        </MemoryRouter>
      );
    }

    const { result } = renderHook(() => useTaskFilters(), { wrapper: DeepLinkWrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(listMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'running',
        projectId: 'project-2',
        capability: 'video',
      }),
    );
    expect(result.current.status).toBe('running');
    expect(result.current.project).toBe('project-2');
  });

  it('导出进行中再次点击不会重复下载', async () => {
    let resolveExport: (() => void) | undefined;
    exportCsvMock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveExport = resolve;
        }),
    );

    const { result } = renderHook(() => useTaskFilters(), { wrapper: TestWrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      void result.current.exportTasks();
      void result.current.exportTasks();
    });

    expect(exportCsvMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveExport?.();
      await Promise.resolve();
    });
    expect(result.current.exporting).toBe(false);
  });
});
