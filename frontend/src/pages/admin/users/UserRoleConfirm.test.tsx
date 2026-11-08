import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { UserRoleConfirm } from './UserRoleConfirm';
import type { AdminUserRow } from './types';

const normalUser: AdminUserRow = {
  id: 'user-1',
  email: 'user@example.com',
  name: '普通用户',
  role: 'user',
  roleLabel: '用户',
  status: 'active',
  statusLabel: '正常',
  createdAt: '2026-01-01T00:00:00.000Z',
  lastLoginAt: null,
  projectCount: 0,
  taskCount: 0,
  assetCount: 0,
};

describe('UserRoleConfirm', () => {
  it('普通用户打开时保持当前角色，不默认提权为运营', () => {
    render(
      <UserRoleConfirm
        target={normalUser}
        loading={false}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    expect(screen.getByRole('combobox', { name: '目标角色' })).toHaveTextContent('用户');
    expect(screen.getByRole('button', { name: '确认变更' })).toBeDisabled();
  });
});
