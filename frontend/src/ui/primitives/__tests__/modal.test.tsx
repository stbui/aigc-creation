import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Modal } from '../modal';

describe('Modal 定位与挂载策略', () => {
  it('position=top 使用顶部定位而不是继续垂直居中', () => {
    render(
      <Modal open title="顶部弹窗" position="top">
        内容
      </Modal>,
    );

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveClass('is-top');
    expect(dialog).not.toHaveClass('is-centered');
    expect(dialog).toHaveStyle({ top: '100px', transform: 'translateX(-50%)' });
  });

  it('keepMounted 在关闭后保留 DOM，但将其隐藏', () => {
    const { rerender } = render(
      <Modal open title="持久弹窗" keepMounted>
        内容
      </Modal>,
    );

    const dialog = screen.getByRole('dialog');
    expect(dialog).not.toHaveAttribute('hidden');

    rerender(
      <Modal open={false} title="持久弹窗" keepMounted>
        内容
      </Modal>,
    );

    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAttribute('hidden');
    expect(dialog).toHaveAttribute('data-state', 'closed');
  });
});
