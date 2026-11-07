import { useMemo, type ReactNode } from 'react';
import {
  ActionButton,
  AdminDataTable,
  StatusTag,
  ToneBadge,
  formatDate,
  type AdminColumn,
} from '~/admin-ui/primitives';
import { EFFECTIVE_META, TYPE_LABEL, type TagTone } from './constants';
import { inWindow, payloadSummary } from './utils';
import type { AdminCampaign } from '../../../types/api';

interface CampaignTableProps {
  rows: AdminCampaign[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  writable: boolean;
  busy: boolean;
  onEdit: (row: AdminCampaign) => void;
  onToggle: (row: AdminCampaign) => void;
  pagination: {
    current: number;
    pageSize: number;
    total: number;
    unit?: string;
    onChange: (page: number, pageSize: number) => void;
  };
  emptyText: string;
  emptyAction?: ReactNode;
}

/** 活动列表：状态列展示派生生效态，时间窗一列标出「active 但未在窗内」 */
export function CampaignTable({
  rows,
  loading,
  error,
  onRetry,
  writable,
  busy,
  onEdit,
  onToggle,
  pagination,
  emptyText,
  emptyAction,
}: CampaignTableProps) {
  const columns: Array<AdminColumn<AdminCampaign>> = useMemo(
    () => [
      { key: 'name', title: '活动名称', width: 160, render: (row) => <span>{row.name}</span> },
      {
        key: 'type',
        title: '类型',
        width: 90,
        render: (row) => <span>{TYPE_LABEL[row.type] ?? row.type}</span>,
      },
      {
        key: 'payload',
        title: '内容',
        width: 150,
        render: (row) => <span className="text-muted-foreground">{payloadSummary(row)}</span>,
      },
      {
        key: 'audience',
        title: '投放人群',
        width: 90,
        render: (row) =>
          row.audience?.onlyNewUsers ? (
            <span>仅新用户</span>
          ) : (
            <span className="text-muted-foreground">全站</span>
          ),
      },
      {
        key: 'window',
        title: '时间窗',
        width: 220,
        render: (row) => {
          const live = inWindow(row);
          return (
            <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
              <span className="tabular-nums text-muted-foreground">
                {formatDate(row.startAt)} ~ {formatDate(row.endAt)}
              </span>
              {/* active 但不在窗内：配置生效了却不会展示，必须让人看见 */}
              {row.status === 'active' && !live && <ToneBadge tone="warn">未在窗内</ToneBadge>}
            </div>
          );
        },
      },
      {
        key: 'status',
        title: '状态',
        width: 90,
        render: (row) => {
          const meta = EFFECTIVE_META[row.effective] ?? {
            label: row.statusLabel,
            tone: 'muted' as TagTone,
          };
          return <StatusTag status={row.status} label={meta.label} tone={meta.tone} />;
        },
      },
      {
        key: 'ops',
        title: '操作',
        width: 120,
        fixed: 'right',
        render: (row) =>
          writable ? (
            <div className="flex items-center gap-1">
              <ActionButton variant="ghost" size="sm" onClick={() => onEdit(row)}>
                编辑
              </ActionButton>
              {/* 后端是 off ↔ active 的翻转；按当前状态给出明确动作名 */}
              <ActionButton variant="ghost" size="sm" disabled={busy} onClick={() => onToggle(row)}>
                {row.status === 'off' ? '上线' : '下线'}
              </ActionButton>
            </div>
          ) : null,
      },
    ],
    [writable, busy, onEdit, onToggle],
  );

  return (
    <AdminDataTable<AdminCampaign>
      rows={rows}
      columns={columns}
      rowKey={(row) => row.id}
      loading={loading}
      error={error}
      onRetry={onRetry}
      /* 整行可点开编辑；只读账号不挂这个入口，避免打开一个存不了的抽屉 */
      onRowClick={writable ? onEdit : undefined}
      minWidth={1010}
      pagination={pagination}
      emptyText={emptyText}
      emptyAction={emptyAction}
    />
  );
}
