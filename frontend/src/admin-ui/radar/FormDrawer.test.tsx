import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ConfirmProvider } from '../providers/ConfirmProvider';
import { FormDrawer } from './formDrawer';

/*
 * 抽屉关闭的确认契约。
 *
 * 页面曾经在 `onClose` 上再包一层 `useDiscardConfirm`，而 FormDrawer 内部也有
 * 一层；于是「取消」会连着弹两次确认。现在约定：确认只在 FormDrawer 里做，
 * 页面传裸 `onClose` —— 这组用例把该约定钉死。
 */
function renderDrawer(props: { dirty?: boolean; busy?: boolean } = {}) {
  const onClose = vi.fn();
  const onSubmit = vi.fn();
  render(
    <ConfirmProvider surface="radar">
      <FormDrawer
        open
        title="编辑提示词"
        onClose={onClose}
        onSubmit={onSubmit}
        dirty={props.dirty}
        busy={props.busy}
      >
        <p>表单内容</p>
      </FormDrawer>
    </ConfirmProvider>,
  );
  return { onClose, onSubmit };
}

describe('FormDrawer 关闭确认', () => {
  it('无修改时直接关闭，不弹确认', async () => {
    const user = userEvent.setup();
    const { onClose } = renderDrawer();

    await user.click(screen.getByRole('button', { name: '取消' }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(screen.queryByTestId('admin-confirm-dialog')).not.toBeInTheDocument();
  });

  it('有修改时只弹一层确认，取消不关闭抽屉', async () => {
    const user = userEvent.setup();
    const { onClose } = renderDrawer({ dirty: true });

    await user.click(screen.getByRole('button', { name: '取消' }));
    expect(screen.getAllByTestId('admin-confirm-dialog')).toHaveLength(1);
    expect(onClose).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: '继续编辑' }));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByTestId('admin-confirm-dialog')).not.toBeInTheDocument();
  });

  it('有修改时确认放弃，只回调一次关闭', async () => {
    const user = userEvent.setup();
    const { onClose } = renderDrawer({ dirty: true });

    await user.click(screen.getByRole('button', { name: '取消' }));
    // 页面再包一层确认的话，这里会同时出现两个确认框
    expect(screen.getAllByTestId('admin-confirm-dialog')).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: '放弃修改' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('保存中不响应关闭，也不弹确认', async () => {
    const user = userEvent.setup();
    const { onClose } = renderDrawer({ dirty: true, busy: true });

    expect(screen.getByRole('button', { name: '取消' })).toBeDisabled();
    await user.keyboard('{Escape}');

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByTestId('admin-confirm-dialog')).not.toBeInTheDocument();
  });
});
