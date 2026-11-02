import { useMemo } from 'react';
import { ActionButton, AdminDataTable, StatusTag, type AdminColumn } from './components';
import { BILLING_MODE_LABELS, STATUS_LABELS, STATUS_TONES } from './constants';
import { toCredits } from './utils';
import type { BillingOrderView } from '../../../types/model';

interface BillingOrderTableProps {
  rows: BillingOrderView[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onOpenDetail: (row: BillingOrderView) => void;
  selectable: boolean;
  selected: string[];
  onSelectedChange: (ids: string[]) => void;
  pagination: {
    current: number;
    pageSize: number;
    total: number;
    onChange: (page: number, pageSize: number) => void;
  };
}

/** 账单列表：一任务一条账单，金额列只展示计费服务给出的结果 */
export function BillingOrderTable({
  rows,
  loading,
  error,
  onRetry,
  onOpenDetail,
  selectable,
  selected,
  onSelectedChange,
  pagination,
}: BillingOrderTableProps) {
  const columns: Array<AdminColumn<BillingOrderView>> = useMemo(
    () => [
      {
        key: 'createdAt',
        title: '时间',
        width: 150,
        render: (row) => (
          <span className="text-[12px] tabular-nums text-muted-foreground">
            {new Date(row.createdAt).toLocaleString('zh-CN')}
          </span>
        ),
      },
      {
        key: 'user',
        title: '用户',
        width: 180,
        render: (row) => (
          <div className="min-w-0">
            <div className="truncate text-[12px] text-foreground">{row.userEmail || '—'}</div>
            <div className="truncate font-mono text-[12px] text-muted-foreground">{row.userId}</div>
          </div>
        ),
      },
      {
        key: 'model',
        title: '模型 / 能力',
        width: 170,
        render: (row) => (
          <div className="min-w-0">
            <div className="truncate font-mono text-[12px] text-foreground">{row.model || '—'}</div>
            <div className="truncate text-[12px] text-muted-foreground">
              {row.capability}
              {row.scene ? ` · ${row.scene}` : ''}
            </div>
          </div>
        ),
      },
      {
        key: 'channel',
        title: '渠道',
        width: 180,
        render: (row) => (
          <div className="min-w-0">
            <div className="truncate text-[12px] text-foreground">{row.channelName || '—'}</div>
            <div className="truncate text-[12px] text-muted-foreground">{row.channelModelName || '—'}</div>
          </div>
        ),
      },
      {
        key: 'billing',
        title: '计费',
        width: 120,
        render: (row) => (
          <div className="flex flex-col gap-0.5 text-[12px]">
            <span className="text-foreground">{BILLING_MODE_LABELS[row.billingMode] ?? row.billingMode}</span>
            <span className="tabular-nums text-muted-foreground">
              数量 {row.quantity}
              {row.multiplierBasisPoints !== 10000 ? ` · 倍率 ${row.multiplierBasisPoints / 100}%` : ''}
            </span>
          </div>
        ),
      },
      {
        key: 'amount',
        title: '金额（积分）',
        width: 130,
        align: 'right',
        render: (row) => (
          <div className="flex flex-col gap-0.5 text-[12px] tabular-nums">
            <span className="text-foreground">
              {toCredits(row.actualAmountMicrocredits || row.reservedAmountMicrocredits)}
            </span>
            {row.refundedAmountMicrocredits > 0 && (
              <span className="text-warn-text">
                退 {toCredits(row.refundedAmountMicrocredits)}
                {row.refundReason === 'route_switch' ? '（换线重预留）' : ''}
              </span>
            )}
          </div>
        ),
      },
      {
        key: 'status',
        title: '状态',
        width: 100,
        render: (row) => (
          <StatusTag
            status={row.status}
            tone={STATUS_TONES[row.status] ?? 'muted'}
            label={STATUS_LABELS[row.status] ?? row.status}
          />
        ),
      },
      {
        key: 'ops',
        title: '操作',
        width: 80,
        fixed: 'right',
        render: (row) => (
          <ActionButton variant="ghost" size="xs" onClick={() => onOpenDetail(row)}>
            详情
          </ActionButton>
        ),
      },
    ],
    [onOpenDetail],
  );

  return (
    <AdminDataTable<BillingOrderView>
      rows={rows}
      columns={columns}
      rowKey={(row) => row.id}
      loading={loading}
      error={rows.length === 0 ? error : null}
      onRetry={onRetry}
      emptyText="没有账单。生成任务成功后才会产生账单记录。"
      minWidth={1220}
      selectable={selectable}
      selected={selected}
      onSelectedChange={onSelectedChange}
      pagination={pagination}
    />
  );
}
