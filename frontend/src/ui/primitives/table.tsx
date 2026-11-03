import type { ReactNode } from 'react';
import { cn } from '../lib/cn';
import { Pagination } from './pagination';
import { Spin } from './spin';

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
  pagination,
  className,
  size = 'middle',
  loading = false,
  scroll,
}: TableProps<T>) {
  const paginationConfig = pagination === false ? null : pagination;
  const pageSize = paginationConfig?.pageSize ?? 20;
  const current = paginationConfig?.current ?? 1;
  const total = paginationConfig?.total ?? dataSource.length;
  // 服务端分页只回传当前页（行数 <= pageSize）；本地分页则持有全量数据。
  const rows = dataSource.length > pageSize
    ? dataSource.slice((current - 1) * pageSize, current * pageSize)
    : dataSource;

  return (
    <div
      className={cn('ui-table-wrap', className)}
      style={{
        ...(scroll?.x ? { overflowX: 'auto' as const } : {}),
        ...(scroll?.y ? { overflowY: 'auto' as const, maxHeight: scroll.y } : {}),
      }}
      aria-busy={loading || undefined}
    >
      <div className="relative">
        <table className={cn('ui-table', size === 'small' && 'is-small')}>
          <thead>
            <tr>
              {columns.map((column, index) => (
                <th
                  key={column.key ?? column.dataIndex ?? index}
                  style={{
                    width: column.width,
                    textAlign: column.align,
                    ...(column.ellipsis
                      ? { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }
                      : {}),
                  }}
                >
                  {column.title}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={getRowKey(row, rowKey, rowIndex)}>
                {columns.map((column, columnIndex) => {
                  const value = column.dataIndex
                    ? (row as Record<string, unknown>)[column.dataIndex]
                    : undefined;
                  return (
                    <td
                      key={column.key ?? column.dataIndex ?? columnIndex}
                      style={{
                        textAlign: column.align,
                        ...(column.ellipsis
                          ? { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }
                          : {}),
                      }}
                    >
                      {column.render ? column.render(value, row, rowIndex) : (value as ReactNode)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/70">
            <Spin size="small" />
          </div>
        )}
      </div>
      {paginationConfig && (
        <div className="mt-3 flex justify-end">
          <Pagination
            current={current}
            pageSize={pageSize}
            total={total}
            hideOnSinglePage={paginationConfig.hideOnSinglePage}
            onChange={paginationConfig.onChange}
          />
        </div>
      )}
    </div>
  );
}
