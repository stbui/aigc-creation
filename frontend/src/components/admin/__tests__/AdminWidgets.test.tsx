import { render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { useAdminUrlFilterSync } from '../AdminWidgets';

type Filters = Record<string, string | number | boolean | undefined>;

/** 探针: 把当前 URL 的 query 渲染出来, 便于断言 hook 的写回结果 */
function Probe({ applied }: { applied: Filters }) {
  useAdminUrlFilterSync(applied);
  const location = useLocation();
  return <span data-testid="search">{location.search}</span>;
}

function renderAt(initialEntry: string, applied: Filters) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Probe applied={applied} />
    </MemoryRouter>,
  );
}

function currentSearch(): string {
  return screen.getByTestId('search').textContent ?? '';
}

/**
 * 后台列表筛选 → 地址栏同步。
 *
 * 守住三条语义: 已生效筛选可分享、重置能清掉旧参数、分页/详情等
 * 非筛选参数不被改写。
 */
describe('useAdminUrlFilterSync', () => {
  it('把已生效的筛选写回地址栏', () => {
    renderAt('/admin/audit', { action: 'user.delete', success: false });

    const search = currentSearch();
    expect(search).toContain('action=user.delete');
    expect(search).toContain('success=false');
  });

  it('筛选被重置时清掉地址栏里的旧值', () => {
    renderAt('/admin/audit?action=user.delete&targetId=u_1', {
      action: undefined,
      targetId: 'u_1',
    });

    const params = new URLSearchParams(currentSearch());
    expect(params.has('action')).toBe(false);
    expect(params.get('targetId')).toBe('u_1');
  });

  it('不改写筛选之外的查询参数', () => {
    renderAt('/admin/tasks?id=t_1&page=7', { capability: 'matting' });

    const params = new URLSearchParams(currentSearch());
    expect(params.get('id')).toBe('t_1');
    expect(params.get('page')).toBe('7');
    expect(params.get('capability')).toBe('matting');
  });
});
