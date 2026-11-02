import { useMemo } from 'react';
import { ActionButton, AdminDataTable, StatusTag, type AdminColumn } from './components';
import { centsToYuanText, validDaysText } from './utils';
import type { AdminProduct } from '../../../types/api';

interface ProductTableProps {
  rows: AdminProduct[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  writable: boolean;
  saving: boolean;
  filtered: boolean;
  onClearFilter: () => void;
  onEdit: (row: AdminProduct) => void;
  onToggle: (row: AdminProduct) => void;
}

/** 商品列表：元与分同时展示，便于与流水核对 */
export function ProductTable({
  rows,
  loading,
  error,
  onRetry,
  writable,
  saving,
  filtered,
  onClearFilter,
  onEdit,
  onToggle,
}: ProductTableProps) {
  const columns: Array<AdminColumn<AdminProduct>> = useMemo(
    () => [
      {
        key: 'product',
        title: '商品',
        width: 220,
        render: (row) => (
          <div className="flex flex-col gap-0.5">
            <span>{row.name}</span>
            <code className="font-mono text-[12px] text-muted-foreground">{row.sku}</code>
          </div>
        ),
      },
      {
        key: 'price',
        title: '售价',
        width: 130,
        render: (row) => (
          <div className="flex flex-col gap-0.5">
            <span className="tabular-nums">¥ {centsToYuanText(row.priceCents)}</span>
            {/* 分的口径同时给出：财务回查流水时看到的是分，免得每次心算 */}
            <span className="text-[12px] tabular-nums text-muted-foreground">
              {row.priceCents} 分
            </span>
          </div>
        ),
      },
      {
        key: 'originalPrice',
        title: '划线价',
        width: 90,
        render: (row) =>
          row.originalPriceCents !== null ? (
            <span className="tabular-nums text-muted-foreground line-through">
              ¥ {centsToYuanText(row.originalPriceCents)}
            </span>
          ) : (
            <span className="text-muted-foreground/60">—</span>
          ),
      },
      {
        key: 'credits',
        title: '赠送积分',
        width: 130,
        render: (row) => (
          <div className="flex flex-col gap-0.5">
            <span className="tabular-nums">{row.credits} 积分</span>
            <span className="text-[12px] text-muted-foreground">
              {validDaysText(row.creditsValidDays)}
            </span>
          </div>
        ),
      },
      {
        key: 'grantType',
        title: '发放方式',
        width: 90,
        render: (row) => (
          <span className="text-[12px] text-muted-foreground">
            {row.grantType === 'immediate' ? '支付即发放' : '人工发放'}
          </span>
        ),
      },
      {
        key: 'sortOrder',
        title: '排序',
        width: 60,
        align: 'right',
        render: (row) => <span className="tabular-nums">{row.sortOrder}</span>,
      },
      {
        key: 'status',
        title: '状态',
        width: 80,
        // `active` 与账号状态的「正常」共用同一个键：商品语境下应读作「在售」
        render: (row) => (
          <StatusTag status={row.status} label={row.status === 'active' ? '在售' : undefined} />
        ),
      },
      {
        key: 'updatedAt',
        title: '更新时间',
        width: 150,
        render: (row) => new Date(row.updatedAt).toLocaleString('zh-CN'),
      },
      {
        key: 'ops',
        title: '',
        width: 120,
        fixed: 'right',
        render: (row) =>
          writable ? (
            <div className="flex items-center gap-1">
              <ActionButton variant="ghost" size="sm" onClick={() => onEdit(row)}>
                编辑
              </ActionButton>
              <ActionButton
                variant={row.status === 'active' ? 'destructive' : 'ghost'}
                size="sm"
                disabled={saving}
                onClick={() => onToggle(row)}
              >
                {row.status === 'active' ? '下架' : '上架'}
              </ActionButton>
            </div>
          ) : null,
      },
    ],
    [writable, saving, onEdit, onToggle],
  );

  return (
    <AdminDataTable<AdminProduct>
      rows={rows}
      columns={columns}
      rowKey={(row) => row.id}
      loading={loading}
      error={error}
      onRetry={onRetry}
      minWidth={1120}
      emptyText={
        filtered
          ? '当前筛选下没有商品。切换状态或清除筛选看看。'
          : '还没有商品。新建一个积分包，C 端结算页才会出现可购买项。'
      }
      emptyAction={
        filtered ? (
          <ActionButton variant="secondary" onClick={onClearFilter}>
            清除筛选
          </ActionButton>
        ) : undefined
      }
    />
  );
}
