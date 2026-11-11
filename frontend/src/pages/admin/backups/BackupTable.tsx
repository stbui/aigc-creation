import { useMemo } from 'react';
import {
  formatDateTime,
  ActionButton,
  AdminDataTable,
  Descriptions,
  RowMenu,
  StatusTag,
  type AdminColumn,
  type RowMenuItem,
} from '~/admin-ui/primitives';
import { backupStatusLabel, formatBytes, formatRelative, triggerLabel } from './utils';
import type { AdminBackup } from '../../../types/api';

interface BackupTableProps {
  rows: AdminBackup[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  expanded: string[];
  onExpandedChange: (keys: string[]) => void;
  canRun: boolean;
  busy: boolean;
  onVerify: (row: AdminBackup) => void;
  onDownload: (row: AdminBackup) => void;
  onDelete: (row: AdminBackup) => void;
}

/**
 * 备份列表：行内详情承载 SHA-256 与验证报告 —— B-97 的举证就在这一层。
 * 未验证的备份只显示置灰的「下载」，不给一个点了报错的按钮。
 */
export function BackupTable({
  rows,
  loading,
  error,
  onRetry,
  expanded,
  onExpandedChange,
  canRun,
  busy,
  onVerify,
  onDownload,
  onDelete,
}: BackupTableProps) {
  const columns: Array<AdminColumn<AdminBackup>> = useMemo(
    () => [
      {
        key: 'filename',
        title: '文件名',
        width: 230,
        render: (row) => (
          <div className="flex flex-col gap-0.5">
            <code className="font-mono text-xs text-foreground">{row.filename}</code>
            <span className="text-[12px] text-muted-foreground">{formatBytes(row.sizeBytes)}</span>
          </div>
        ),
      },
      {
        key: 'trigger',
        title: '触发',
        width: 80,
        render: (row) => (
          <span className="text-xs text-muted-foreground">{triggerLabel(row.trigger)}</span>
        ),
      },
      {
        key: 'status',
        title: '备份状态',
        width: 90,
        render: (row) => <StatusTag status={row.status} label={backupStatusLabel(row.status)} />,
      },
      {
        key: 'verified',
        title: '恢复验证',
        width: 110,
        render: (row) => {
          if (row.status !== 'succeeded') {
            return <span className="text-[12px] text-muted-foreground">—</span>;
          }
          return row.verified ? (
            <StatusTag status="verified" label="已验证" tone="success" />
          ) : (
            <StatusTag status="unverified" label="未验证" tone="warn" />
          );
        },
      },
      {
        key: 'createdAt',
        title: '创建时间',
        width: 110,
        render: (row) => (
          <span
            className="text-xs text-muted-foreground"
            title={formatDateTime(row.createdAt)}
          >
            {formatRelative(row.createdAt)}
          </span>
        ),
      },
      {
        key: 'actions',
        title: '',
        width: 180,
        fixed: 'right',
        render: (row) => {
          /*
           * 直显只留「详情 / 下载」：验证与删除都是低频动作（验证在生成后一次，
           * 删除要过二次确认），四颗按钮平铺会把这一列撑到 230px，右侧固定列
           * 抢走正文宽度。
           */
          const moreItems: RowMenuItem[] = [];
          if (canRun && row.status === 'succeeded') {
            moreItems.push({
              key: 'verify',
              label: '验证可恢复性',
              disabled: busy,
              onSelect: () => onVerify(row),
            });
          }
          if (canRun) {
            moreItems.push({
              key: 'delete',
              label: '删除备份',
              danger: true,
              separator: moreItems.length > 0,
              disabled: busy,
              onSelect: () => onDelete(row),
            });
          }
          return (
            <div className="flex items-center gap-1">
              <ActionButton
                variant="ghost"
                size="sm"
                onClick={() =>
                  onExpandedChange(
                    expanded.includes(row.id)
                      ? expanded.filter((key) => key !== row.id)
                      : [row.id],
                  )
                }
              >
                {expanded.includes(row.id) ? '收起' : '详情'}
              </ActionButton>
              {row.verified ? (
                <ActionButton variant="ghost" size="sm" onClick={() => onDownload(row)}>
                  下载
                </ActionButton>
              ) : (
                /* B-97: 无验证记录的备份视为无效, 不给下载入口 */
                <span
                  className="cursor-not-allowed text-[12px] text-muted-foreground"
                  title="未通过恢复验证的备份不可下载"
                >
                  下载
                </span>
              )}
              <RowMenu label={`备份 ${row.id} 更多操作`} items={moreItems} />
            </div>
          );
        },
      },
    ],
    [expanded, onExpandedChange, canRun, busy, onVerify, onDownload, onDelete],
  );

  return (
    <AdminDataTable<AdminBackup>
      rows={rows}
      columns={columns}
      rowKey={(row) => row.id}
      loading={loading}
      error={error}
      onRetry={onRetry}
      minWidth={860}
      density="compact"
      renderExpanded={(row) => (
        <Descriptions
          columns={2}
          items={[
            {
              label: 'SHA-256',
              value: <code className="break-all font-mono text-[12px]">{row.sha256 || '—'}</code>,
            },
            {
              label: '源库大小',
              value: row.sourceSizeBytes !== null ? formatBytes(row.sourceSizeBytes) : '—',
            },
            {
              label: '验证时间',
              value: row.verifiedAt ? formatDateTime(row.verifiedAt) : '未验证',
            },
            ...(row.verifyReport ? [{ label: '验证报告', value: row.verifyReport }] : []),
            ...(row.verifyWarnings
              ? [
                  {
                    label: '验证告警',
                    value: <span className="text-warn-text">{row.verifyWarnings}</span>,
                  },
                ]
              : []),
            ...(row.errorMessage
              ? [
                  {
                    label: '失败原因',
                    value: <span className="text-danger-text">{row.errorMessage}</span>,
                  },
                ]
              : []),
          ]}
        />
      )}
      expandedKeys={expanded}
      onExpandedChange={onExpandedChange}
    />
  );
}
