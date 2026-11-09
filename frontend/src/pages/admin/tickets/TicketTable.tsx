import { Link } from 'react-router-dom';
import { ActionButton, AdminDataTable, StatusTag, type AdminColumn } from '~/admin-ui/primitives';
import {
  PRIORITY_LABELS,
  PRIORITY_TONE,
  STATUS_LABELS,
  STATUS_TONE,
  TYPE_LABELS,
} from './constants';
import { adminUserDetailHref } from './utils';
import type { AdminTicketRow } from '../../../types/api';

/**
 * 工单列表。
 *
 * 行内只保留「处理」一个入口 —— 状态流转与回复都在详情抽屉里完成，避免在
 * 列表上误点流转动到不该动的工单。
 */
export function TicketTable({
  rows,
  loading,
  error,
  hasFilter,
  current,
  pageSize,
  total,
  onRetry,
  onResetFilters,
  onOpen,
  canClaim = false,
  onClaim,
  onPageChange,
}: {
  rows: AdminTicketRow[];
  loading: boolean;
  error: string | null;
  hasFilter: boolean;
  current: number;
  pageSize: number;
  total: number;
  onRetry: () => void;
  onResetFilters: () => void;
  onOpen: (id: string) => void;
  canClaim?: boolean;
  onClaim?: (id: string) => void;
  onPageChange: (page: number, pageSize?: number) => void;
}) {
  const columns: Array<AdminColumn<AdminTicketRow>> = [
    {
      key: 'subject',
      title: '工单 / 标题',
      width: 280,
      render: (row) => (
        <div className="flex flex-col gap-0.5">
          <button
            type="button"
            className="max-w-[260px] truncate rounded text-left text-brand hover:underline"
            title={row.subject}
            onClick={() => onOpen(row.id)}
          >
            {row.subject}
          </button>
          <span className="text-[12px] text-muted-foreground">
            <code className="font-mono">{row.ticketNo}</code> ·{' '}
            {row.typeLabel || TYPE_LABELS[row.type]}
          </span>
        </div>
      ),
    },
    {
      key: 'user',
      title: '提交人',
      width: 180,
      render: (row) => (
        <div className="flex flex-col gap-0.5">
          <span>{row.userName || '—'}</span>
          <Link
            className="block max-w-[170px] truncate text-[12px] text-brand hover:underline"
            title={row.userEmail}
            to={adminUserDetailHref(row.userId)}
          >
            {row.userEmail}
          </Link>
        </div>
      ),
    },
    {
      key: 'priority',
      title: '优先级',
      width: 80,
      render: (row) => (
        <StatusTag
          status={row.priority}
          label={PRIORITY_LABELS[row.priority]}
          tone={PRIORITY_TONE[row.priority]}
        />
      ),
    },
    {
      key: 'status',
      title: '状态',
      width: 100,
      render: (row) => (
        <StatusTag status={row.status} label={STATUS_LABELS[row.status]} tone={STATUS_TONE[row.status]} />
      ),
    },
    {
      key: 'replyCount',
      title: '回复',
      width: 70,
      align: 'right',
      render: (row) => (
        <span className="tabular-nums text-muted-foreground">{row.replyCount} 条</span>
      ),
    },
    {
      key: 'time',
      title: '提交 / 更新',
      width: 170,
      render: (row) => (
        <div className="flex flex-col gap-0.5 text-[12px] tabular-nums text-muted-foreground">
          <span>{new Date(row.createdAt).toLocaleString('zh-CN')}</span>
          <span>{new Date(row.updatedAt).toLocaleString('zh-CN')}</span>
        </div>
      ),
    },
    {
      key: 'ops',
      title: '',
      width: 150,
      fixed: 'right',
      render: (row) => (
        <div className="flex items-center justify-end gap-1">
          {canClaim && !row.assigneeId && onClaim && (
            <ActionButton variant="secondary" size="sm" onClick={() => onClaim(row.id)}>
              认领
            </ActionButton>
          )}
          <ActionButton variant="ghost" size="sm" onClick={() => onOpen(row.id)}>
            处理
          </ActionButton>
        </div>
      ),
    },
  ];

  return (
    <AdminDataTable<AdminTicketRow>
      rows={rows}
      columns={columns}
      rowKey={(row) => row.id}
      loading={loading}
      error={error}
      onRetry={onRetry}
      minWidth={1000}
      emptyText={
        hasFilter
          ? '当前筛选下没有工单。清除筛选后可查看全部工单。'
          : '还没有工单。用户提交问题后会出现在这里。'
      }
      emptyAction={
        hasFilter ? (
          <ActionButton variant="secondary" onClick={onResetFilters}>
            清除筛选
          </ActionButton>
        ) : undefined
      }
      pagination={{
        current,
        pageSize,
        total,
        unit: '张工单',
        onChange: onPageChange,
      }}
    />
  );
}
