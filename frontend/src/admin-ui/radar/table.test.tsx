import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AdminDataTable, type AdminColumn } from './table';

interface Row {
  id: string;
  name: string;
  price: number;
}

const rows: Row[] = [
  { id: 'a', name: '甲', price: 1 },
  { id: 'b', name: '乙', price: 2 },
];

const columns: Array<AdminColumn<Row>> = [
  { key: 'name', title: '名称' },
  { key: 'price', title: '价格', align: 'right' },
];

describe('AdminDataTable 的列显隐', () => {
  it('默认渲染全部列，表头与表体列数一致', () => {
    render(
      <AdminDataTable
        rows={rows}
        columns={columns}
        rowKey={(row) => row.id}
      />,
    );
    const headerCells = screen.getAllByRole('columnheader');
    expect(headerCells).toHaveLength(2);
    const bodyRows = screen.getAllByTestId('admin-table-row');
    for (const bodyRow of bodyRows) {
      expect(bodyRow.querySelectorAll('td')).toHaveLength(2);
    }
  });

  it('隐藏列后表头与表体同时少一列', () => {
    render(
      <AdminDataTable
        rows={rows}
        columns={columns}
        rowKey={(row) => row.id}
        hiddenColumns={['price']}
      />,
    );
    const headerCells = screen.getAllByRole('columnheader');
    expect(headerCells).toHaveLength(1);
    expect(headerCells[0]).toHaveTextContent('名称');
    expect(screen.queryByText('价格')).toBeNull();
    const bodyRows = screen.getAllByTestId('admin-table-row');
    for (const bodyRow of bodyRows) {
      expect(bodyRow.querySelectorAll('td')).toHaveLength(1);
    }
  });
});
