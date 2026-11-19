import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmAlert } from './ConfirmAlert';
import { ConfirmDialog } from './overlays';

/*
 * 确认浮层的交互契约：取消只回调一次、确认不自动收起、loading 期间不可退出。
 * Radix 的 Action / Cancel 自带关闭行为，业务回调不能再重复接一次，否则父级
 * 会在一次点击里收到两次 onCancel。
 */
describe('ConfirmAlert', () => {
  it('取消只回调一次', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(
      <ConfirmAlert
        testId="admin-confirm-test"
        title="删除用户"
        description={<p>操作不可撤销。</p>}
        confirmText="确认"
        onCancel={onCancel}
        onConfirm={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: '取消' }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('确认回调一次且弹框不自行收起，初始焦点落在取消上', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <ConfirmAlert
        testId="admin-confirm-test"
        title="删除用户"
        description={<p>操作不可撤销。</p>}
        confirmText="确认"
        onCancel={vi.fn()}
        onConfirm={onConfirm}
      />,
    );

    expect(screen.getByRole('button', { name: '取消' })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: '确认' }));
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(screen.getByTestId('admin-confirm-test')).toBeInTheDocument();
  });

  it('loading 期间按钮禁用且 Esc 不关闭', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(
      <ConfirmAlert
        testId="admin-confirm-test"
        title="删除用户"
        description={<p>操作不可撤销。</p>}
        confirmText="处理中…"
        loading
        onCancel={onCancel}
        onConfirm={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: '取消' })).toBeDisabled();
    await user.keyboard('{Escape}');
    expect(onCancel).not.toHaveBeenCalled();
  });
});

describe('ConfirmDialog', () => {
  it('取消只回调一次', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        open
        title="停用供应商"
        description={<p>停用后新任务不会使用该供应商。</p>}
        onCancel={onCancel}
        onConfirm={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: '取消' }));
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
