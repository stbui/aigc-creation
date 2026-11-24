import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PLANNED_PERMISSIONS } from '../constants';

/**
 * T-045：孤儿权限点的展示与保存语义。
 *
 * 6 个「后端已登记、暂无页面或接口消费」的权限点保留定义，在角色页标「未上线」，
 * 但**保持可勾选** —— 已存在的旧授权必须能被管理员取消，禁用勾选框会让它们无法清理。
 *
 * 两条底线：
 *   ① 6 个 key 有 badge，`data.search`（真实在用）没有；
 *   ② 预置带未上线权限的角色，只改别的权限后保存，未上线项原样保留（不得静默撤权）。
 */

const mocks = vi.hoisted(() => ({
  data: { value: null as null | { roles: unknown[]; allPermissions: string[] } },
  reload: vi.fn(),
  updatePermissions: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock('../hooks', () => ({
  useAdmin: () => ({
    can: () => true,
    me: { role: 'admin' },
    refresh: async () => {},
    isHighRisk: () => false,
  }),
  useConfirm: () => async () => true,
  useToast: () => ({ success: mocks.success, error: mocks.error }),
  useUnsavedGuard: () => {},
  useAdminResource: () => ({
    data: mocks.data.value,
    loading: false,
    error: null,
    reload: mocks.reload,
  }),
}));

vi.mock('../api', () => ({
  adminRolesApi: {
    list: vi.fn(),
    updatePermissions: (...args: unknown[]) => mocks.updatePermissions(...args),
  },
  adminApi: { permissions: vi.fn() },
}));

import { AdminRolesPage } from '../page';

const ALL_PERMISSIONS = [
  ...PLANNED_PERMISSIONS,
  'data.search',
  'product.read',
  'product.write',
  'role.read',
  'role.write',
];

function renderPage(rolePermissions: string[]) {
  mocks.data.value = {
    roles: [
      {
        code: 'finance',
        label: '财务',
        description: '财务角色',
        permissions: rolePermissions,
        builtIn: true,
      },
    ],
    allPermissions: ALL_PERMISSIONS,
  };
  return render(<AdminRolesPage />);
}

describe('未上线权限点的标注', () => {
  beforeEach(() => {
    mocks.updatePermissions.mockReset();
    mocks.reload.mockReset();
  });

  it('6 个孤儿权限点都带「未上线」badge', () => {
    renderPage(['finance.dashboard', 'product.read']);

    for (const code of PLANNED_PERMISSIONS) {
      expect(screen.getByTestId(`admin-perm-planned-${code}`), code).toBeInTheDocument();
    }
    expect(screen.getAllByText('未上线')).toHaveLength(PLANNED_PERMISSIONS.length);
  });

  it('data.search 在真实消费，不打「未上线」', () => {
    renderPage(['finance.dashboard']);

    expect(screen.queryByTestId('admin-perm-planned-data.search')).not.toBeInTheDocument();
    expect(screen.getByText('data.search')).toBeInTheDocument();
  });

  it('列表顶部有说明，且未上线项仍可勾选（不禁用）', () => {
    renderPage(['finance.dashboard', 'product.read']);

    expect(screen.getByTestId('admin-planned-permissions-note')).toHaveTextContent(
      /勾选暂不生效/,
    );

    const plannedCheckbox = screen.getByRole('checkbox', { name: '财务 · 查看财务概览' });
    expect(plannedCheckbox).toBeEnabled();
    expect(plannedCheckbox).toBeChecked();
  });
});

describe('保存时保留未上线权限的旧授权', () => {
  beforeEach(() => {
    mocks.updatePermissions.mockReset();
    mocks.reload.mockReset();
    mocks.reload.mockResolvedValue(undefined);
  });

  it('只改别的权限后保存，未上线项原样提交', async () => {
    renderPage(['finance.dashboard', 'product.read']);

    // 取消一个与孤儿权限点无关的权限（product.read）
    fireEvent.click(screen.getByRole('checkbox', { name: '财务 · 查看商品' }));
    await waitFor(() =>
      expect(screen.getByTestId('admin-role-save-bar')).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole('button', { name: /保存全部变更/ }));

    await waitFor(() => expect(mocks.updatePermissions).toHaveBeenCalledTimes(1));
    const payload = mocks.updatePermissions.mock.calls[0][0] as Array<{
      code: string;
      permissions: string[];
    }>;

    expect(payload).toEqual([
      { code: 'finance', permissions: expect.arrayContaining(['finance.dashboard']) },
    ]);
    expect(payload[0].permissions).not.toContain('product.read');
  });

  it('保存时不会因为未上线而丢掉已勾选项（全量提交 draft）', async () => {
    renderPage(['finance.dashboard', 'compliance.gate', 'product.read']);

    fireEvent.click(screen.getByRole('checkbox', { name: '财务 · 查看商品' }));
    await waitFor(() =>
      expect(screen.getByTestId('admin-role-save-bar')).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole('button', { name: /保存全部变更/ }));

    await waitFor(() => expect(mocks.updatePermissions).toHaveBeenCalledTimes(1));
    const payload = mocks.updatePermissions.mock.calls[0][0] as Array<{
      code: string;
      permissions: string[];
    }>;

    expect(payload[0].permissions).toEqual(
      expect.arrayContaining(['finance.dashboard', 'compliance.gate']),
    );
    expect(payload[0].permissions).not.toContain('product.read');
  });
});