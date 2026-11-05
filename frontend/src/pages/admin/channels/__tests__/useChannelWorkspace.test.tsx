import { act, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { BrowserRouter, MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import type { AdminChannelView } from '../../../../types/model';
import { useAdminDetailParam } from '../../../../admin-ui/primitives';
import {
  useActionLock,
  useChannelList,
  useChannelSelection,
  useChannelView,
} from '../hooks';

const channelApi = vi.hoisted(() => ({
  fetchAllChannels: vi.fn(),
  fetchChannelHealth: vi.fn(),
}));

vi.mock('../api', () => channelApi);

function channel(id: string): AdminChannelView {
  return {
    id,
    userId: '',
    scope: 'system',
    enabled: true,
    name: `渠道 ${id}`,
    sortOrder: 0,
    baseUrl: 'https://example.com',
    apiKey: '',
    apiFormat: 'openai',
    concurrencyLimit: 0,
    proxyUrl: '',
    models: [],
    modelCosts: [],
    hasApiKey: true,
    hasSecretKey: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

interface SelectionHarnessProps {
  visible: AdminChannelView[];
  loading?: boolean;
  error?: string | null;
  view?: 'channels' | 'models';
}

function useSelectionHarness({
  visible,
  loading = false,
  error = null,
  view = 'channels',
}: SelectionHarnessProps) {
  const [selectedId, setSelectedId] = useAdminDetailParam();
  const location = useLocation();
  useChannelSelection({ visible, loading, error, view, selectedId, setSelectedId });
  return { selectedId, search: location.search };
}

function selectionWrapper(initialEntry: string) {
  return function Wrapper({ children }: PropsWithChildren) {
    return <MemoryRouter initialEntries={[initialEntry]}>{children}</MemoryRouter>;
  };
}

function useViewHarness() {
  const [view, setView] = useChannelView();
  const location = useLocation();
  const navigate = useNavigate();
  return { view, setView, search: location.search, navigate };
}

function useCombinedUrlHarness() {
  const [selectedId, setSelectedId] = useAdminDetailParam();
  const [view, setView] = useChannelView();
  const location = useLocation();
  return { selectedId, setSelectedId, view, setView, search: location.search };
}

describe('useChannelSelection', () => {
  it('列表加载后自动选中首个可见渠道并写入地址栏', async () => {
    const first = channel('c1');
    const { result } = renderHook(() => useSelectionHarness({ visible: [first, channel('c2')] }), {
      wrapper: selectionWrapper('/admin/channels'),
    });

    await waitFor(() => expect(result.current.selectedId).toBe('c1'));
    expect(result.current.search).toContain('id=c1');
  });

  it('有效深链优先于自动选中', async () => {
    const { result } = renderHook(
      () => useSelectionHarness({ visible: [channel('c1'), channel('c2')] }),
      { wrapper: selectionWrapper('/admin/channels?id=c2') },
    );

    await waitFor(() => expect(result.current.selectedId).toBe('c2'));
    expect(result.current.search).toContain('id=c2');
  });

  it('选中项被筛选隐藏后回退到首个可见渠道', async () => {
    const { result, rerender } = renderHook(
      ({ visible }: { visible: AdminChannelView[] }) => useSelectionHarness({ visible }),
      {
        initialProps: { visible: [channel('c1'), channel('c2')] },
        wrapper: selectionWrapper('/admin/channels?id=c2'),
      },
    );

    await waitFor(() => expect(result.current.selectedId).toBe('c2'));
    rerender({ visible: [channel('c1')] });

    await waitFor(() => expect(result.current.selectedId).toBe('c1'));
    expect(result.current.search).toContain('id=c1');
  });

  it('没有渠道时不自动写 id', async () => {
    const { result } = renderHook(() => useSelectionHarness({ visible: [] }), {
      wrapper: selectionWrapper('/admin/channels'),
    });

    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.selectedId).toBeNull();
    expect(result.current.search).toBe('');
  });

  it('无效 id 在列表加载后回退到首个可见渠道', async () => {
    const { result } = renderHook(() => useSelectionHarness({ visible: [channel('c1')] }), {
      wrapper: selectionWrapper('/admin/channels?id=deleted-channel'),
    });

    await waitFor(() => expect(result.current.selectedId).toBe('c1'));
    expect(result.current.search).toContain('id=c1');
  });
});

describe('useChannelView', () => {
  it('从地址栏读取视图，并跟随前进后退', async () => {
    const { result } = renderHook(() => useViewHarness(), {
      wrapper: selectionWrapper('/admin/channels'),
    });
    expect(result.current.view).toBe('channels');

    act(() => result.current.navigate('/admin/channels?view=models'));
    await waitFor(() => expect(result.current.view).toBe('models'));

    act(() => result.current.navigate(-1));
    await waitFor(() => expect(result.current.view).toBe('channels'));
  });

  it('切换视图写回地址栏，切回默认视图时移除冗余参数', async () => {
    const { result } = renderHook(() => useViewHarness(), {
      wrapper: selectionWrapper('/admin/channels'),
    });

    act(() => result.current.setView('models'));
    await waitFor(() => expect(result.current.search).toBe('?view=models'));

    act(() => result.current.setView('channels'));
    await waitFor(() => expect(result.current.search).toBe(''));
  });

  it('同一轮写入选中的渠道与视图时不互相覆盖', async () => {
    window.history.replaceState({}, '', '/admin/channels?view=models');
    const { result } = renderHook(() => useCombinedUrlHarness(), {
      wrapper: ({ children }: PropsWithChildren) => <BrowserRouter>{children}</BrowserRouter>,
    });

    act(() => {
      result.current.setSelectedId('c2');
      result.current.setView('channels');
    });

    await waitFor(() => expect(result.current.view).toBe('channels'));
    expect(result.current.selectedId).toBe('c2');
    expect(result.current.search).toBe('?id=c2');
  });
});

describe('useActionLock', () => {
  it('同一时间只执行一个动作，结束后允许再次执行', async () => {
    let release: (() => void) | undefined;
    const task = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const { result } = renderHook(() => useActionLock());

    let first: Promise<boolean>;
    let second: Promise<boolean>;
    act(() => {
      first = result.current.run(task);
      second = result.current.run(task);
    });

    expect(task).toHaveBeenCalledTimes(1);
    expect(result.current.busy).toBe(true);
    await expect(second!).resolves.toBe(false);

    await act(async () => {
      release?.();
      await expect(first!).resolves.toBe(true);
    });
    expect(result.current.busy).toBe(false);
  });
});

describe('useChannelList', () => {
  it('并发刷新时只采纳最后一次请求的结果', async () => {
    let resolveFirst: ((rows: AdminChannelView[]) => void) | undefined;
    let resolveSecond: ((rows: AdminChannelView[]) => void) | undefined;
    channelApi.fetchAllChannels
      .mockImplementationOnce(
        () =>
          new Promise<AdminChannelView[]>((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<AdminChannelView[]>((resolve) => {
            resolveSecond = resolve;
          }),
      );

    const { result } = renderHook(() => useChannelList());
    await waitFor(() => expect(channelApi.fetchAllChannels).toHaveBeenCalledTimes(1));

    let reload: Promise<void>;
    act(() => {
      reload = result.current.reload();
    });
    await waitFor(() => expect(channelApi.fetchAllChannels).toHaveBeenCalledTimes(2));

    await act(async () => {
      resolveSecond?.([channel('c2')]);
      await reload!;
    });
    expect(result.current.rows.map((row) => row.id)).toEqual(['c2']);

    await act(async () => {
      resolveFirst?.([channel('c1')]);
      await Promise.resolve();
    });
    expect(result.current.rows.map((row) => row.id)).toEqual(['c2']);
    expect(result.current.loading).toBe(false);
  });
});
