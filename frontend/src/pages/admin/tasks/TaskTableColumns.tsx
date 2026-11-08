import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  ActionButton,
  StatusTag,
  type AdminColumn,
} from '~/admin-ui/primitives';
import { assetThumbUrl } from './api';
import {
  adminTasksHref,
  adminUserDetailHref,
  formatDuration,
  shortId,
  taskErrorLabel,
} from './utils';
import type { AdminTaskRow, TaskActionKind } from './types';

interface UseTaskTableColumnsOptions {
  can: (permission: string) => boolean;
  onOpenDetail: (id: string) => void;
  onAction: (kind: TaskActionKind, task: AdminTaskRow) => void;
}

/** 任务宽表的列定义；展示逻辑与页面编排分离，避免筛选和写操作状态反复重算。 */
export function useTaskTableColumns({
  can,
  onOpenDetail,
  onAction,
}: UseTaskTableColumnsOptions) {
  return useMemo<Array<AdminColumn<AdminTaskRow>>>(
    () => [
      {
        key: 'task',
        title: '任务',
        width: 132,
        cellTitle: (row) => row.id,
        render: (row) => (
          <div className="flex min-w-0 items-center gap-2">
            {row.thumbnailUrl ? (
              <img
                className="size-7 shrink-0 rounded border border-border object-cover"
                src={assetThumbUrl(row.thumbnailUrl, 96)}
                alt=""
                loading="lazy"
              />
            ) : (
              <div className="size-7 shrink-0 rounded border border-dashed border-border bg-muted" />
            )}
            <code className="truncate font-mono text-[12px] text-muted-foreground">
              {shortId(row.id)}
            </code>
          </div>
        ),
      },
      {
        key: 'capability',
        title: '能力',
        width: 120,
        sortable: true,
        cellTitle: (row) => `${row.capabilityName} · ${row.capability}`,
        render: (row) => <span className="block truncate">{row.capabilityName}</span>,
      },
      {
        key: 'status',
        title: '状态',
        width: 92,
        sortable: true,
        cellTitle: (row) =>
          row.status === 'failed' && row.errorCode ? taskErrorLabel(row.errorCode) : undefined,
        render: (row) => <StatusTag status={row.status} />,
      },
      {
        key: 'user',
        title: '用户',
        width: 156,
        cellTitle: (row) => row.user.email,
        render: (row) => (
          <Link
            className="block truncate text-brand hover:underline"
            to={adminUserDetailHref(row.user.id)}
          >
            {row.user.email}
          </Link>
        ),
      },
      {
        key: 'project',
        title: '项目',
        width: 128,
        cellTitle: (row) => row.project.name,
        render: (row) => (
          <Link
            className="block truncate text-brand hover:underline"
            to={adminTasksHref({ projectId: row.project.id })}
          >
            {row.project.name}
          </Link>
        ),
      },
      {
        key: 'durationMs',
        title: '耗时',
        width: 76,
        cellTitle: (row) => (row.status === 'running' ? '任务执行中，耗时仍在增长' : undefined),
        render: (row) => (
          <span className="text-[12px] tabular-nums whitespace-nowrap">
            {formatDuration(row.durationMs)}
          </span>
        ),
      },
      {
        key: 'createdAt',
        title: '创建时间',
        width: 140,
        sortable: true,
        render: (row) => (
          <span className="block truncate text-[12px] tabular-nums text-muted-foreground">
            {new Date(row.createdAt).toLocaleString('zh-CN')}
          </span>
        ),
      },
      {
        key: 'ops',
        title: '操作',
        width: 148,
        /* 固定在最右，保证滚动时主操作仍可见。 */
        fixed: 'right',
        render: (row) => (
          <div className="flex items-center gap-1 whitespace-nowrap">
            <ActionButton variant="ghost" size="sm" onClick={() => onOpenDetail(row.id)}>
              详情
            </ActionButton>
            {/*
             * 重试/终止按状态出现，而不是一律置灰：
             * 「仅失败任务可重试」是后端硬校验，给一个点不动的按钮只会让人反复试。
             */}
            {row.status === 'failed' && can('task.retry') && (
              <ActionButton variant="ghost" size="sm" onClick={() => onAction('retry', row)}>
                重试
              </ActionButton>
            )}
            {(row.status === 'queued' || row.status === 'running') && can('task.cancel') && (
              <ActionButton
                variant="destructive"
                size="sm"
                onClick={() => onAction('cancel', row)}
              >
                终止
              </ActionButton>
            )}
            {/* 仅终态可删；排队中/执行中必须先终止，避免 worker 回写已删除任务。 */}
            {(row.status === 'succeeded' ||
              row.status === 'failed' ||
              row.status === 'cancelled') &&
              can('task.delete') && (
                <ActionButton
                  variant="ghost"
                  size="sm"
                  className="text-danger-text hover:text-danger-text"
                  onClick={() => onAction('delete', row)}
                >
                  删除
                </ActionButton>
              )}
          </div>
        ),
      },
    ],
    [can, onAction, onOpenDetail],
  );
}
