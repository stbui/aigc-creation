import type { ReactNode } from 'react';
import { cn } from '../lib/cn';

export interface TableColumn<T> {
  key?: string;
  dataIndex?: string;
  title?: ReactNode;
  render?: (value: any, row: T, index: number) => ReactNode;
  width?: number | string;
  align?: 'left' | 'center' | 'right';
  ellipsis?: boolean;
}

export interface TableProps<T> {
  columns: TableColumn<T>[];
  dataSource?: T[];
  rowKey?: keyof T | ((row: T) => string);
  pagination?: false | {
    current?: number;
    pageSize?: number;
    total?: number;
    onChange?: (page: number, pageSize: number) => void;
    hideOnSinglePage?: boolean;
    showSizeChanger?: boolean;
  };
  className?: string;
  size?: 'small' | 'middle' | 'large';
  loading?: boolean;
  scroll?: { x?: number | string; y?: number | string };
}

function getRowKey<T>(row: T, rowKey: TableProps<T>['rowKey'], index: number) {
  if (typeof rowKey === 'function') return rowKey(row);
  if (rowKey) return String(row[rowKey]);
  return String(index);
}

/** antd Table 的兼容壳：只支持 C 端现有的只读表格形态。 */
export function Table<T>({
  columns,
  dataSource = [],
  rowKey,
  className,
  size = 'middle',
  scroll,
}: TableProps<T>) {
  return (
    <div
      className={cn('ui-table-wrap', size === 'small' && 'is-small', className)}
      style={scroll?.x ? { overflowX: 'auto' } : undefined}
    >
      <table className="ui-table">
        <thead>
          <tr>
            {columns.map((column, index) => (
              <th
                key={column.key ?? column.dataIndex ?? index}
                style={{ width: column.width, textAlign: column.align }}
              >
                {column.title}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {dataSource.map((row, rowIndex) => (
            <tr key={getRowKey(row, rowKey, rowIndex)}>
              {columns.map((column, columnIndex) => {
                const value = column.dataIndex
                  ? (row as Record<string, unknown>)[column.dataIndex]
                  : undefined;
                return (
                  <td
                    key={column.key ?? column.dataIndex ?? columnIndex}
                    style={{ textAlign: column.align }}
                  >
                    {column.render ? column.render(value, row, rowIndex) : (value as ReactNode)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
