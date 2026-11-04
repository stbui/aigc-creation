import { Download, RefreshCw } from 'lucide-react';
import {
  ActionButton,
  AdminDataTable,
  BatchBar,
  Panel,
  StaleError,
  type AdminColumn,
} from '~/admin-ui/primitives';
import type { AdminTaskListResult } from '../../../types/api';
import type { AdminTaskRow, TaskActionKind } from './types';

interface TaskListSectionProps {
  data: AdminTaskListResult | null;
  columns: Array<AdminColumn<AdminTaskRow>>;
  loading: boolean;
  error: string | null;
  hasFilter: boolean;
  sort: string;
  selected: string[];
  busy: boolean;
  exporting: boolean;
  canRetry: boolean;
  canCancel: boolean;
  canDelete: boolean;
  canExport: boolean;
  onSelectedChange: (keys: string[]) => void;
  onBatchAction: (kind: TaskActionKind) => void;
  onSortChange: (sort: string | null) => void;
  onRetry: () => void;
  onResetFilters: () => void;
  onOpenDetail: (id: string) => void;
  onPageChange: (page: number, pageSize: number) => void;
  onExport: () => void;
}

/** 任务列表面板：工具栏、批量入口、紧凑表格和分页。 */
export function TaskListSection({
  data,
  columns,
  loading,
  error,
  hasFilter,
  sort,
  selected,
  busy,
  exporting,
  canRetry,
  canCancel,
  canDelete,
  canExport,
  onSelectedChange,
  onBatchAction,
  onSortChange,
  onRetry,
  onResetFilters,
  onOpenDetail,
  onPageChange,
  onExport,
}: TaskListSectionProps) {
  const result = data?.result;

  return (
    <>
      {/* 刷新失败但手上还有上一次的数据：只挂提示，不把整个列表藏起来。 */}
      {error && data && <StaleError error={error} onRetry={onRetry} />}

      <Panel
        title="任务列表"
        extra={
          <>
            <BatchBar
              count={selected.length}
              unit="项"
              className="mb-0 rounded-none border-0 bg-transparent p-0"
            >
              {canRetry && (
                <ActionButton
                  variant="secondary"
                  size="sm"
                  disabled={busy}
                  onClick={() => onBatchAction('retry')}
                >
                  批量重试
                </ActionButton>
              )}
              {canCancel && (
                <ActionButton
                  variant="destructive"
                  size="sm"
                  disabled={busy}
                  onClick={() => onBatchAction('cancel')}
                >
                  批量终止
                </ActionButton>
              )}
              {canDelete && (
                <ActionButton
                  variant="ghost"
                  size="sm"
                  className="text-danger-text hover:text-danger-text"
                  disabled={busy}
                  onClick={() => onBatchAction('delete')}
                >
                  批量删除
                </ActionButton>
              )}
              <ActionButton variant="ghost" size="sm" onClick={() => onSelectedChange([])}>
                清空选择
              </ActionButton>
            </BatchBar>
            {selected.length > 0 && <span className="h-5 w-px bg-border" aria-hidden />}
            <ActionButton
              variant="secondary"
              size="sm"
              icon={RefreshCw}
              disabled={loading}
              onClick={onRetry}
            >
              {loading ? '刷新中…' : '刷新'}
            </ActionButton>
            {canExport && (
              <ActionButton
                variant="secondary"
                size="sm"
                icon={Download}
                disabled={exporting}
                onClick={onExport}
              >
                {exporting ? '导出中…' : '导出 CSV'}
              </ActionButton>
            )}
          </>
        }
      >
        <AdminDataTable<AdminTaskRow>
          rows={result?.items ?? []}
          columns={columns}
          rowKey={(row) => row.id}
          loading={loading}
          error={error}
          onRetry={onRetry}
          sort={sort}
          onSortChange={onSortChange}
          /* 单字段单行展示：固定列宽，避免内容把行高重新撑成两行。 */
          minWidth={1080}
          fixedLayout
          density="compact"
          selectable
          selected={selected}
          onSelectedChange={onSelectedChange}
          /*
           * 整行可点开详情。此前只有最右侧那个「详情」文字链是入口，
           * 而它恰好是被横向裁掉的那一列。
           */
          onRowClick={(row) => onOpenDetail(row.id)}
          emptyText={
            hasFilter
              ? '没有符合条件的任务。清除筛选或换一个条件试试。'
              : '还没有任务。在前台任意生成一次，这里就会出现记录。'
          }
          emptyAction={
            hasFilter ? (
              <ActionButton variant="secondary" size="sm" onClick={onResetFilters}>
                清除筛选
              </ActionButton>
            ) : undefined
          }
          pagination={
            result
              ? {
                  current: result.page,
                  pageSize: result.pageSize,
                  total: result.total,
                  unit: '条',
                  onChange: onPageChange,
                }
              : undefined
          }
        />
      </Panel>
    </>
  );
}
