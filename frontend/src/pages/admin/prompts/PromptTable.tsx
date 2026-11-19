import { useMemo, type ReactNode } from 'react';

import { ActionButton, AdminDataTable, StatusTag, ToneBadge, type AdminColumn } from './components';
import { formatDate, modalityLabel, promptHeading } from './utils';
import { PromptImagePreview } from './PromptImagePreview';
import type { AdminPrompt } from './types';

interface PromptTableProps {
  rows: AdminPrompt[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  writable: boolean;
  busy: boolean;
  onEdit: (row: AdminPrompt) => void;
  onToggle: (row: AdminPrompt) => void;
  onDelete: (row: AdminPrompt) => void;
  sort: string | null;
  onSortChange: (sort: string | null) => void;
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

/** 提示词列表：正文只显示摘要，完整内容在编辑抽屉里查看。 */
export function PromptTable({
  rows,
  loading,
  error,
  onRetry,
  writable,
  busy,
  onEdit,
  onToggle,
  onDelete,
  sort,
  onSortChange,
  pagination,
  emptyText,
  emptyAction,
}: PromptTableProps) {
  const columns = useMemo<Array<AdminColumn<AdminPrompt>>>(() => {
    const cols: Array<AdminColumn<AdminPrompt>> = [
      {
        key: 'title',
        title: '标题',
        width: 240,
        sortable: true,
        render: (row) => (
          <div className="flex min-w-0 items-center gap-2">
            {row.images.length > 0 && (
              <div className="relative size-9 shrink-0 overflow-hidden rounded border border-border bg-muted/40">
                <PromptImagePreview
                  image={row.images[0]}
                  size={96}
                  alt={`${promptHeading(row)} 配图`}
                />
                {row.images.length > 1 && (
                  <span className="absolute bottom-0 right-0 rounded-tl bg-foreground/70 px-1 text-[12px] leading-4 text-background">
                    {row.images.length}
                  </span>
                )}
              </div>
            )}
            <div className="min-w-0">
              <div className="truncate font-medium text-foreground">{promptHeading(row)}</div>
              <div className="truncate text-[12px] leading-4 text-muted-foreground">
                {row.content}
              </div>
            </div>
          </div>
        ),
      },
      {
        key: 'category',
        title: '分类',
        width: 110,
        render: (row) =>
          row.category ? (
            <span>{row.category}</span>
          ) : (
            <span className="text-muted-foreground">未分类</span>
          ),
      },
      {
        key: 'modality',
        title: '模态',
        width: 80,
        render: (row) => <span>{modalityLabel(row.modality)}</span>,
      },
      {
        key: 'tags',
        title: '标签',
        width: 180,
        render: (row) =>
          row.tags.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {row.tags.map((tag) => (
                <ToneBadge key={tag} tone="neutral">
                  {tag}
                </ToneBadge>
              ))}
            </div>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        key: 'sortOrder',
        title: '排序',
        width: 70,
        align: 'right',
        sortable: true,
        render: (row) => <span className="tabular-nums">{row.sortOrder}</span>,
      },
      {
        key: 'status',
        title: '状态',
        width: 80,
        render: (row) => (
          <StatusTag
            status={row.enabled ? 'enabled' : 'disabled'}
            // 打开态直接取 STATUS_META；关闭态在本页读作「已停用」而非账号的「已禁用」
            label={row.enabled ? undefined : '已停用'}
            tone={row.enabled ? undefined : 'muted'}
          />
        ),
      },
      {
        key: 'updatedAt',
        title: '更新时间',
        width: 150,
        sortable: true,
        render: (row) => (
          <span className="tabular-nums text-muted-foreground">{formatDate(row.updatedAt)}</span>
        ),
      },
    ];

    if (writable) {
      cols.push({
        key: 'ops',
        title: '操作',
        width: 170,
        fixed: 'right',
        render: (row) => (
          <div className="flex items-center gap-1">
            <ActionButton variant="ghost" size="sm" onClick={() => onEdit(row)}>
              编辑
            </ActionButton>
            <ActionButton variant="ghost" size="sm" disabled={busy} onClick={() => onToggle(row)}>
              {row.enabled ? '停用' : '启用'}
            </ActionButton>
            <ActionButton variant="ghost" size="sm" disabled={busy} onClick={() => onDelete(row)}>
              删除
            </ActionButton>
          </div>
        ),
      });
    }

    return cols;
  }, [writable, busy, onEdit, onToggle, onDelete]);

  return (
    <AdminDataTable<AdminPrompt>
      rows={rows}
      columns={columns}
      rowKey={(row) => row.id}
      loading={loading}
      error={error}
      onRetry={onRetry}
      onRowClick={writable ? onEdit : undefined}
      minWidth={writable ? 1090 : 920}
      sort={sort}
      onSortChange={onSortChange}
      pagination={pagination}
      emptyText={emptyText}
      emptyAction={emptyAction}
    />
  );
}
