import { useMemo } from 'react';
import { Trash2 } from 'lucide-react';
import { ActionButton, AdminDataTable, StatusTag, type AdminColumn } from '~/admin-ui/primitives';
import { BADGE_STYLE_LABELS } from './constants';
import { toCreditsInput } from './utils';
import type { ChannelOrderItemView, UserGroupView } from '../../../types/model';

interface UserGroupTableProps {
  rows: UserGroupView[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  writable: boolean;
  channels: ChannelOrderItemView[];
  onEdit: (row: UserGroupView) => void;
  onDelete: (row: UserGroupView) => void;
}

/** 分组列表：默认分组不可删除，编码创建后不可改 */
export function UserGroupTable({
  rows,
  loading,
  error,
  onRetry,
  writable,
  channels,
  onEdit,
  onDelete,
}: UserGroupTableProps) {
  const channelNameById = useMemo(
    () => new Map(channels.map((item) => [item.id, item.name])),
    [channels],
  );

  const columns: Array<AdminColumn<UserGroupView>> = useMemo(
    () => [
      {
        key: 'name',
        title: '分组',
        width: 220,
        render: (row) => (
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="truncate font-medium text-foreground">{row.name}</span>
              {row.isDefault && <StatusTag status="default" tone="brand" label="默认" />}
              {row.badgeStyle !== 'none' && (
                <StatusTag
                  status="badge"
                  tone="brand"
                  label={row.badgeLabel || BADGE_STYLE_LABELS[row.badgeStyle] || row.badgeStyle}
                />
              )}
            </div>
            <div className="mt-0.5 truncate font-mono text-[12px] text-muted-foreground">{row.code}</div>
          </div>
        ),
      },
      {
        key: 'users',
        title: '用户数',
        width: 80,
        align: 'right',
        render: (row) => <span className="tabular-nums">{row.userCount}</span>,
      },
      {
        key: 'ratio',
        title: '倍率',
        width: 90,
        align: 'right',
        render: (row) => (
          <span className="tabular-nums">{Math.round(row.ratioBasisPoints / 100)}%</span>
        ),
      },
      {
        key: 'rate',
        title: '点数汇率',
        width: 170,
        render: (row) => (
          <div className="flex flex-col gap-0.5 text-[12px] tabular-nums">
            <span>1 USD = {toCreditsInput(row.pointsPerUsdMicrocredits)} 积分</span>
            <span className="text-muted-foreground">
              1 CNY = {toCreditsInput(row.pointsPerCnyMicrocredits)} 积分
            </span>
          </div>
        ),
      },
      {
        key: 'channels',
        title: '可见渠道',
        width: 170,
        render: (row) =>
          row.allChannels ? (
            <StatusTag status="all" tone="success" label="全部渠道" />
          ) : (
            <span
              className="truncate text-[12px] text-muted-foreground"
              title={row.channelIds.map((id) => channelNameById.get(id) ?? id).join('、')}
            >
              {row.channelIds.length} 条：
              {row.channelIds.map((id) => channelNameById.get(id) ?? id).join('、')}
            </span>
          ),
      },
      {
        key: 'overrides',
        title: '模型覆盖',
        width: 90,
        align: 'right',
        render: (row) => <span className="tabular-nums">{row.modelOverrides.length}</span>,
      },
      {
        key: 'ops',
        title: '操作',
        width: 150,
        fixed: 'right',
        render: (row) => (
          <div className="flex items-center gap-1">
            <ActionButton variant="ghost" size="sm" disabled={!writable} onClick={() => onEdit(row)}>
              编辑
            </ActionButton>
            <ActionButton
              variant="ghost"
              size="sm"
              icon={Trash2}
              disabled={!writable || row.isDefault}
              onClick={() => onDelete(row)}
            >
              删除
            </ActionButton>
          </div>
        ),
      },
    ],
    [channelNameById, writable, onEdit, onDelete],
  );

  return (
    <AdminDataTable<UserGroupView>
      rows={rows}
      columns={columns}
      rowKey={(row) => row.id}
      loading={loading}
      error={rows.length === 0 ? error : null}
      onRetry={onRetry}
      emptyText="没有分组。默认分组由系统维护，通常无需手工创建。"
      minWidth={1020}
    />
  );
}
