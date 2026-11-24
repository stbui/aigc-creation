import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ROLE_PERMISSIONS_FOR_TEST } from './adminRouteAccessTestFixtures';

/**
 * 守卫的渲染行为：无权限时必须是 `NoPageAccess`，不是子页面、不是接口错误页。
 *
 * 这条测试存在的理由：T-044 之前的真实故障形态是「直敲 URL → 子页面发请求 →
 * 后端 403 → 渲染成『加载失败』」，用户看到的是「页面坏了」而不是「你没权限」。
 * 断言 `admin-no-page-access` 出现**且**子页面标记不出现，才算守卫生效。
 */

const mocks = vi.hoisted(() => ({
  can: vi.fn(),
  loading: false,
}));

vi.mock('../../../../context/AdminContext', () => ({
  useAdmin: () => ({
    can: mocks.can,
    canAny: (...ps: string[]) => ps.some((p) => mocks.can(p)),
    loading: mocks.loading,
  }),
}));

import { AdminRouteGuard } from '../AdminRouteGuard';

/** 子页面替身：真页面的 `data-testid` 一旦出现就说明守卫放行了 */
function StoragePageStub() {
  return <div data-testid="admin-storage-page">storage page</div>;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/admin/*"
          element={
            <AdminRouteGuard>
              <Routes>
                <Route path="storage" element={<StoragePageStub />} />
              </Routes>
            </AdminRouteGuard>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe('AdminRouteGuard 渲染', () => {
  beforeEach(() => {
    mocks.can.mockReset();
    mocks.loading = false;
  });

  it('无权限时渲染 NoPageAccess，不渲染子页面', () => {
    mocks.can.mockReturnValue(false);
    renderAt('/admin/storage');

    expect(screen.getByTestId('admin-no-page-access')).toBeInTheDocument();
    expect(screen.queryByTestId('admin-storage-page')).not.toBeInTheDocument();
  });

  it('拒绝页说明缺哪个权限并给出返回入口', () => {
    mocks.can.mockReturnValue(false);
    renderAt('/admin/storage');

    // 中文标签来自 PERMISSION_LABELS（setting.read → 查看系统设置）
    expect(screen.getByText(/查看系统设置/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '返回平台概览' })).toHaveAttribute(
      'href',
      '/admin',
    );
  });

  it('有权限时渲染子页面，不渲染拒绝页', () => {
    const granted = new Set(ROLE_PERMISSIONS_FOR_TEST.operator);
    mocks.can.mockImplementation((permission: string) => granted.has(permission));
    renderAt('/admin/storage');

    expect(screen.getByTestId('admin-storage-page')).toBeInTheDocument();
    expect(screen.queryByTestId('admin-no-page-access')).not.toBeInTheDocument();
  });

  it('权限未就绪时不闪「无权限」', () => {
    mocks.can.mockReturnValue(false);
    mocks.loading = true;
    renderAt('/admin/storage');

    expect(screen.queryByTestId('admin-no-page-access')).not.toBeInTheDocument();
    expect(screen.queryByTestId('admin-storage-page')).not.toBeInTheDocument();
  });
});
