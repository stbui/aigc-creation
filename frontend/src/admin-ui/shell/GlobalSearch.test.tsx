import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AdminSearchResult } from '../../types/api';

const { searchMock } = vi.hoisted(() => ({ searchMock: vi.fn() }));

vi.mock('../../lib/api', () => ({
  adminSearchApi: { search: searchMock },
}));

import { GlobalSearch } from './GlobalSearch';

const SEARCH_RESULT: AdminSearchResult = {
  query: 'alice',
  total: 2,
  groups: [
    {
      key: 'users',
      label: '用户',
      total: 1,
      items: [
        {
          id: 'user-1',
          title: 'Alice',
          subtitle: 'alice@example.com',
          link: '/admin/users?id=user-1',
        },
      ],
    },
    {
      key: 'orders',
      label: '订单',
      total: 1,
      items: [
        {
          id: 'order-1',
          title: 'ORD-1',
          subtitle: '¥ 99.00',
          link: '/admin/orders?id=order-1',
        },
      ],
    },
  ],
};

beforeEach(() => {
  vi.useFakeTimers();
  searchMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('GlobalSearch', () => {
  it('支持 Ctrl+K 打开搜索框', async () => {
    render(<GlobalSearch onNavigate={vi.fn()} />);

    await act(async () => {
      fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
    });

    expect(screen.getByRole('dialog', { name: '全局搜索' })).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: '搜索用户、订单、工单、任务或素材' })).toHaveFocus();
  });

  it('少于 2 个字符不请求，输入后防抖搜索并按回车跳转', async () => {
    const onNavigate = vi.fn();
    searchMock.mockResolvedValue(SEARCH_RESULT);
    render(<GlobalSearch onNavigate={onNavigate} />);

    fireEvent.click(screen.getByTestId('admin-global-search-trigger'));
    const input = screen.getByRole('searchbox', { name: '搜索用户、订单、工单、任务或素材' });

    await act(async () => {
      fireEvent.change(input, { target: { value: 'a' } });
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(searchMock).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.change(input, { target: { value: 'alice' } });
      await vi.advanceTimersByTimeAsync(219);
    });
    expect(searchMock).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(searchMock).toHaveBeenCalledWith('alice', expect.any(AbortSignal));
    expect(screen.getByText('Alice')).toBeInTheDocument();

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onNavigate).toHaveBeenCalledWith('/admin/orders?id=order-1');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('新输入会中止上一轮未完成的搜索请求', async () => {
    searchMock.mockImplementation(() => new Promise(() => {}));
    render(<GlobalSearch onNavigate={vi.fn()} />);

    fireEvent.click(screen.getByTestId('admin-global-search-trigger'));
    const input = screen.getByRole('searchbox', { name: '搜索用户、订单、工单、任务或素材' });

    await act(async () => {
      fireEvent.change(input, { target: { value: 'alice' } });
      await vi.advanceTimersByTimeAsync(220);
    });
    const firstSignal = searchMock.mock.calls[0][1] as AbortSignal;
    expect(firstSignal.aborted).toBe(false);

    await act(async () => {
      fireEvent.change(input, { target: { value: 'alice@example.com' } });
    });
    expect(firstSignal.aborted).toBe(true);
  });
});
