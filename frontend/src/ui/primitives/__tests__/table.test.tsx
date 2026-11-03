import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { Table, type TableColumn } from '../table';

interface Row {
  id: number;
  name: string;
}

const columns: Array<TableColumn<Row>> = [
  { key: 'name', dataIndex: 'name', title: '名称' },
];

const rows = Array.from({ length: 25 }, (_, index) => ({
  id: index + 1,
  name: `第 ${index + 1} 行`,
}));

describe('Table 兼容层', () => {
  it('本地分页只渲染当前页，并回传页码', () => {
    const onChange = vi.fn();
    render(
      <Table
        columns={columns}
        dataSource={rows}
        rowKey="id"
        pagination={{ current: 2, pageSize: 10, total: rows.length, onChange }}
      />,
    );

    expect(screen.getByText('第 11 行')).toBeInTheDocument();
    expect(screen.queryByText('第 1 行')).not.toBeInTheDocument();
    expect(screen.getByText('第 2 / 3 页')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '下一页' }));
    expect(onChange).toHaveBeenCalledWith(3, 10);
  });

  it('服务端分页不会再次切片当前页数据', () => {
    const currentPage = rows.slice(10, 20);
    render(
      <Table
        columns={columns}
        dataSource={currentPage}
        rowKey="id"
        pagination={{ current: 2, pageSize: 10, total: 200 }}
      />,
    );

    expect(screen.getByText('第 11 行')).toBeInTheDocument();
    expect(screen.getByText('第 20 行')).toBeInTheDocument();
    expect(screen.getByText('第 2 / 20 页')).toBeInTheDocument();
  });

  it('loading 会暴露忙碌状态与加载指示器', () => {
    render(<Table columns={columns} dataSource={rows.slice(0, 2)} rowKey="id" loading />);

    expect(document.querySelector('[aria-busy="true"]')).toBeInTheDocument();
    expect(screen.getByRole('status', { name: '加载中' })).toBeInTheDocument();
  });
});
