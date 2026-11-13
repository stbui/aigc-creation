import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../context/AdminContext', () => ({
  useAdmin: () => ({ me: { id: 'admin-1' } }),
}));

import { SavedViewBar } from './saved-view-bar';

beforeEach(() => {
  localStorage.clear();
});

describe('SavedViewBar', () => {
  it('活动视图只看已应用筛选，草稿变化不会切换活动态', () => {
    render(
      <SavedViewBar
        pageKey="tasks"
        appliedFilters={{ status: 'running' }}
        draftFilters={{ status: 'failed' }}
        onApply={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: '执行中积压' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: '近 24h 失败' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('草稿未应用时给出提示、提供应用动作，并禁止保存当前筛选', async () => {
    const user = userEvent.setup();
    const onApplyDraft = vi.fn();
    render(
      <SavedViewBar
        pageKey="tasks"
        appliedFilters={{ status: 'running' }}
        draftFilters={{ status: 'failed' }}
        onApply={vi.fn()}
        onApplyDraft={onApplyDraft}
      />,
    );

    expect(screen.getByTestId('admin-saved-view-draft')).toHaveTextContent('筛选有未应用修改');
    expect(screen.getByRole('button', { name: '保存当前筛选' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: '应用筛选' }));
    expect(onApplyDraft).toHaveBeenCalledOnce();
  });

  it('内置视图不显示删除入口', () => {
    render(
      <SavedViewBar
        pageKey="tickets"
        appliedFilters={{}}
        onApply={vi.fn()}
      />,
    );

    expect(screen.queryByRole('button', { name: /删除视图/ })).not.toBeInTheDocument();
  });

  it('应用视图时传出解析后的筛选条件', async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    render(
      <SavedViewBar
        pageKey="tickets"
        appliedFilters={{}}
        onApply={onApply}
      />,
    );

    await user.click(screen.getByRole('button', { name: '我处理中' }));
    expect(onApply).toHaveBeenCalledWith({
      status: 'processing',
      assigneeId: 'admin-1',
    });
  });
});
