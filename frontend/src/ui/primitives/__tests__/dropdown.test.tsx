import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { Dropdown } from '../dropdown';

describe('Dropdown 链接项', () => {
  it('to 把整行渲染为链接，而不是按钮伪装的路由跳转', async () => {
    render(
      <MemoryRouter>
        <Dropdown
          menu={{
            items: [{ key: 'works', label: '我的作品', to: '/works' }],
          }}
        >
          <button type="button">打开菜单</button>
        </Dropdown>
      </MemoryRouter>,
    );

    await userEvent.click(screen.getByRole('button', { name: '打开菜单' }));
    const link = screen.getByRole('menuitem', { name: '我的作品' });
    expect(link).toHaveAttribute('href', '/works');
    expect(link.tagName).toBe('A');
  });
});
