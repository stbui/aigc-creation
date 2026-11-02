import { useMemo } from 'react';
import { ActionButton, AdminDataTable, StatusTag, type AdminColumn } from './components';
import { centsToYuan } from './utils';
import type { AdminMembershipPlan } from '../../../types/api';

interface PlanTableProps {
  rows: AdminMembershipPlan[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  writable: boolean;
  saving: boolean;
  onCreate: () => void;
  onEdit: (row: AdminMembershipPlan) => void;
  onToggle: (row: AdminMembershipPlan) => void;
}

/** 会员套餐列表：`free` 套餐内置不下架；其余上下架走带原因的确认条 */
export function PlanTable({
  rows,
  loading,
  error,
  onRetry,
  writable,
  saving,
  onCreate,
  onEdit,
  onToggle,
}: PlanTableProps) {
  const columns: Array<AdminColumn<AdminMembershipPlan>> = useMemo(
    () => [
      {
        key: 'plan',
        title: '套餐',
        width: 180,
        render: (row) => (
          <div className="flex flex-col gap-0.5">
            <span className="font-medium">{row.name}</span>
            <code className="font-mono text-[12px] text-muted-foreground">{row.code}</code>
            {row.description && (
              <span
                className="max-w-[220px] truncate text-[12px] text-muted-foreground"
                title={row.description}
              >
                {row.description}
              </span>
            )}
          </div>
        ),
      },
      {
        key: 'price',
        title: '订阅价',
        width: 85,
        render: (row) => (
          <div className="flex flex-col gap-0.5">
            <span className="tabular-nums">¥ {centsToYuan(row.priceCents)}</span>
            <span className="text-[12px] tabular-nums text-muted-foreground">
              {row.priceCents} 分
            </span>
          </div>
        ),
      },
      {
        key: 'duration',
        title: '周期',
        width: 60,
        render: (row) => (row.durationDays === 0 ? '永久' : `${row.durationDays} 天`),
      },
      {
        key: 'credits',
        title: '每月积分',
        width: 70,
        render: (row) => <span className="tabular-nums">{row.monthlyCredits}</span>,
      },
      {
        key: 'perks',
        title: '权益',
        width: 220,
        render: (row) => (
          <div className="flex flex-wrap gap-1">
            {row.perkLabels.map((label) => (
              <span
                key={label}
                className="rounded-md bg-muted px-1.5 py-0.5 text-[12px] text-muted-foreground"
              >
                {label}
              </span>
            ))}
          </div>
        ),
      },
      {
        key: 'usage',
        title: '会员 / 订单',
        width: 80,
        render: (row) => (
          <span className="tabular-nums text-muted-foreground">
            {row.memberCount} / {row.orderCount}
          </span>
        ),
      },
      {
        key: 'status',
        title: '状态',
        width: 70,
        render: (row) => (
          <StatusTag status={row.status} label={row.status === 'active' ? '在售' : '已下架'} />
        ),
      },
      {
        key: 'actions',
        title: '操作',
        width: 120,
        render: (row) => (
          <div className="flex items-center gap-1">
            <ActionButton
              variant="ghost"
              size="sm"
              onClick={() => onEdit(row)}
              disabled={!writable}
            >
              编辑
            </ActionButton>
            {row.code === 'free' ? (
              <span
                className="px-1.5 text-[12px] text-muted-foreground"
                title="free 套餐由系统内置，不能下架"
              >
                内置
              </span>
            ) : (
              <ActionButton
                variant={row.status === 'active' ? 'destructive' : 'ghost'}
                size="sm"
                disabled={!writable || saving}
                onClick={() => onToggle(row)}
              >
                {row.status === 'active' ? '下架' : '上架'}
              </ActionButton>
            )}
          </div>
        ),
      },
    ],
    [writable, saving, onEdit, onToggle],
  );

  return (
    <AdminDataTable<AdminMembershipPlan>
      rows={rows}
      columns={columns}
      rowKey={(row) => row.id}
      loading={loading}
      error={error}
      onRetry={onRetry}
      minWidth={900}
      emptyText="还没有会员套餐。新建一个套餐，C 端价目表才会出现可订阅项。"
      emptyAction={
        writable ? (
          <ActionButton variant="secondary" onClick={onCreate}>
            新建套餐
          </ActionButton>
        ) : undefined
      }
    />
  );
}
