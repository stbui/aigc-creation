import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from '../../index';

describe('DropdownMenu 链接项', () => {
  it('to 把整行渲染为链接，而不是按钮伪装的路由跳转', async () => {
    render(
      <MemoryRouter>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button">打开菜单</button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuGroup>
              <DropdownMenuItem asChild>
                <a href="/works">我的作品</a>
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </MemoryRouter>,
    );

    await userEvent.click(screen.getByRole('button', { name: '打开菜单' }));
    const link = screen.getByRole('menuitem', { name: '我的作品' });
    expect(link).toHaveAttribute('href', '/works');
    expect(link.tagName).toBe('A');
  });
});
