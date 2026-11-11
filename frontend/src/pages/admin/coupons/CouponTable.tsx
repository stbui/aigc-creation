import { Plus } from 'lucide-react';
import {
  ActionButton,
  AdminDataTable,
  Meter,
  RowMenu,
  StatusTag,
  formatDate,
  type AdminColumn,
} from '~/admin-ui/primitives';
import {
  EFFECTIVE_META,
  SCOPE_LABEL,
  TYPE_LABEL,
  type TagTone,
} from './constants';
import { faceValue, yuan } from './utils';
import type { AdminCoupon } from '../../../types/api';

/**
 * 券列表。
 *
 * 状态列优先展示派生生效态：过期 / 未开始 / 售罄不是人工停用，
 * 混在一起会让运营以为开关被谁动过。
 */
export function CouponTable({
  rows,
  loading,
  error,
  hasFilter,
  current,
  pageSize,
  total,
  writable,
  busy,
  onEdit,
  onToggle,
  onDelete,
  onPageChange,
  onRetry,
  onResetFilters,
  onCreate,
}: {
  rows: AdminCoupon[];
  loading: boolean;
  error: string | null;
  hasFilter: boolean;
  current: number;
  pageSize: number;
  total: number;
  writable: boolean;
  busy: boolean;
  onEdit: (row: AdminCoupon) => void;
  onToggle: (row: AdminCoupon) => void;
  onDelete: (row: AdminCoupon) => void;
  onPageChange: (page: number, size?: number) => void;
  onRetry: () => void;
  onResetFilters: () => void;
  onCreate: () => void;
}) {
  const columns: Array<AdminColumn<AdminCoupon>> = [
    {
      key: 'code',
      title: '券码',
      /* 券码最长 24 位等宽字符，125px 会贴到名称列 */
      width: 150,
      render: (row) => (
        <button
          type="button"
          className="rounded font-mono font-medium text-brand hover:underline"
          onClick={() => onEdit(row)}
        >
          {row.code}
        </button>
      ),
    },
    { key: 'name', title: '名称', width: 150, render: (row) => <span>{row.name}</span> },
    {
      key: 'type',
      title: '类型',
      width: 70,
      render: (row) => <span>{TYPE_LABEL[row.type] ?? row.type}</span>,
    },
    {
      key: 'value',
      title: '面额',
      width: 90,
      render: (row) => (
        <span className="font-medium text-brand">
          {faceValue({ type: row.type, value: row.value })}
        </span>
      ),
    },
    {
      key: 'threshold',
      title: '门槛',
      width: 90,
      render: (row) =>
        row.thresholdCents > 0 ? (
          <span className="tabular-nums">满 ¥{yuan(row.thresholdCents)}</span>
        ) : (
          <span className="text-muted-foreground">无门槛</span>
        ),
    },
    {
      key: 'scope',
      title: '适用范围',
      width: 110,
      render: (row) => <span>{SCOPE_LABEL[row.scope] ?? row.scope}</span>,
    },
    {
      key: 'used',
      title: '核销',
      width: 100,
      render: (row) => {
        const total = row.totalCount === 0 ? null : row.totalCount;
        const occupied = row.usedCount + row.pendingReserved;
        const pct = total ? Math.round((occupied / total) * 100) : null;
        return (
          <div className="flex flex-col gap-1">
            <span className="tabular-nums">
              {occupied}
              {total ? ` / ${total}` : ' / 不限'}
            </span>
            {row.pendingReserved > 0 && (
              <span className="text-xs text-muted-foreground">
                含待支付预占 {row.pendingReserved}
              </span>
            )}
            {pct !== null && (
              <Meter value={Math.min(pct, 100)} className="h-1 w-16" decorative />
            )}
          </div>
        );
      },
    },
    {
      key: 'valid',
      title: '有效期',
      width: 180,
      render: (row) => (
        <span className="tabular-nums text-muted-foreground">
          {formatDate(row.validFrom)} ~ {formatDate(row.validTo)}
        </span>
      ),
    },
    {
      key: 'status',
      title: '状态',
      width: 80,
      render: (row) => {
        const meta =
          EFFECTIVE_META[row.effective] ?? { label: row.status, tone: 'muted' as TagTone };
        return <StatusTag status={row.status} label={meta.label} tone={meta.tone} />;
      },
    },
    {
      key: 'ops',
      title: '操作',
      width: 160,
      fixed: 'right',
      render: (row) =>
        writable ? (
          <div className="flex items-center gap-1">
            <ActionButton variant="ghost" size="sm" onClick={() => onEdit(row)}>
              编辑
            </ActionButton>
            <ActionButton
              variant="ghost"
              size="sm"
              /* 停用不必用一整块红底: 一行一个红按钮会把整张表压成告警墙 */
              className={row.status === 'on' ? 'text-danger-text' : undefined}
              disabled={busy}
              onClick={() => onToggle(row)}
            >
              {row.status === 'on' ? '停用' : '启用'}
            </ActionButton>
            <RowMenu
              label={`${row.name} 更多操作`}
              items={[
                {
                  key: 'delete',
                  label: '删除',
                  danger: true,
                  onSelect: () => onDelete(row),
                },
              ]}
            />
          </div>
        ) : null,
    },
  ];

  return (
    <AdminDataTable<AdminCoupon>
      rows={rows}
      columns={columns}
      rowKey={(row) => row.id}
      loading={loading}
      error={error}
      onRetry={onRetry}
      /* 整行可点开编辑；只读账号不挂这个入口，避免打开一个存不了的抽屉 */
      onRowClick={writable ? onEdit : undefined}
      /* 只设下限：抬到列宽总和会把状态列挤出 1280 视口的可视区 */
      minWidth={1120}
      pagination={{
        current,
        pageSize,
        total,
        unit: '张',
        onChange: onPageChange,
      }}
      emptyText={
        hasFilter
          ? '没有匹配的优惠券。清除筛选条件后再试。'
          : '还没有优惠券。新建第一张券，C 端结算页才会出现可用的抵扣项。'
      }
      emptyAction={
        hasFilter ? (
          <ActionButton variant="secondary" size="sm" onClick={onResetFilters}>
            清除筛选
          </ActionButton>
        ) : writable ? (
          <ActionButton variant="default" size="sm" icon={Plus} onClick={onCreate}>
            创建第一张券
          </ActionButton>
        ) : undefined
      }
    />
  );
}
