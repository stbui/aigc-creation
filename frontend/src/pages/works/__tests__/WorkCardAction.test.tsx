import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { WorkCardAction } from '../WorkCardAction';

describe('WorkCardAction', () => {
  it('to 渲染链接并保留新标签页与右键菜单能力', () => {
    render(
      <MemoryRouter>
        <WorkCardAction to="/tool/product-kit">再做一张</WorkCardAction>
      </MemoryRouter>,
    );

    const link = screen.getByRole('link', { name: '再做一张' });
    expect(link).toHaveAttribute('href', '/tool/product-kit');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('当前页动作仍支持键盘触发', async () => {
    const onActivate = vi.fn();
    render(<WorkCardAction onActivate={onActivate}>预览</WorkCardAction>);

    const action = screen.getByRole('button', { name: '预览' });
    action.focus();
    await userEvent.keyboard('{Enter}');
    expect(onActivate).toHaveBeenCalledOnce();
  });
});
