import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DensityContext } from '../../lib/density';
import { AdminDataTable } from '../DataTable';

/**
 * 表格密度：外壳的开关要真的落到行高上。
 *
 * 2026-10-30 换 BoardUI 后，密度开关从「外壳写 `adm-layout.is-compact` 类」改成
 * 经 `DensityContext` 下发 —— 类没了，如果表格不读 context，开关就变成按了没反应
 * 的死按钮。这里同时守两件事：context 生效，以及显式 `density` prop 优先。
 */

interface Row {
  id: string;
  name: string;
}

const ROWS: Row[] = [{ id: 'a1', name: '线路 A' }];
const COLUMNS = [
  { key: 'id', title: '编号' },
  { key: 'name', title: '名称' },
];

function renderTable(density?: 'comfortable' | 'compact', shellDensity?: 'comfortable' | 'compact') {
  const table = <AdminDataTable rows={ROWS} columns={COLUMNS} rowKey={(row) => row.id} density={density} />;
  return render(
    shellDensity ? (
      <DensityContext.Provider value={shellDensity}>{table}</DensityContext.Provider>
    ) : (
      table
    ),
  );
}

/** 行高类名：宽松 h-11（44px）/ 紧凑 h-9（36px） */
function rowHeightClass(): string {
  const row = screen.getByTestId('admin-table-row');
  return row.classList.contains('h-9') ? 'h-9' : row.classList.contains('h-11') ? 'h-11' : '';
}

describe('AdminDataTable 密度', () => {
  it('没有外壳与 prop 时用宽松档', () => {
    renderTable();
    expect(rowHeightClass()).toBe('h-11');
  });

  it('读外壳下发的密度', () => {
    renderTable(undefined, 'compact');
    expect(rowHeightClass()).toBe('h-9');
  });

  it('显式 density prop 优先于外壳', () => {
    renderTable('comfortable', 'compact');
    expect(rowHeightClass()).toBe('h-11');
  });
});
