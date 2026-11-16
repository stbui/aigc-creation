import { useMemo } from 'react';
import {
  ActionButton,
  AdminDataTable,
  ExportCsvButton,
  Panel,
  RefreshButton,
  StatusTag,
  StaleError,
  type AdminColumn,
} from './components';
import {
  CAPABILITY_LABELS,
  OPERATION_LABELS,
  REQUEST_KIND_LABELS,
  SOURCE_LABELS,
  STATUS_LABELS,
  STATUS_TONES,
} from './constants';
import type { ApiLogView } from './types';
import { formatDateTime, formatDuration } from './utils';

/**
 * 调用明细列表。
 *
 * 列定义留在这里而不是页面里：列的内容、宽度、空态文案属于列表自身的展示
 * 契约，页面只需要回答「谁打开详情、谁触发刷新」。同名的一列若两处维护，
 * 迟早出现表格里和信息卡里对不上。
 */
export function ModelCallListSection({
  rows,
  loading,
  error,
  hasFilter,
  pagination,
  exporting,
  canExport,
  onExport,
  onRefresh,
  onOpenDetail,
  onResetFilters,
}: {
  rows: ApiLogView[];
  loading: boolean;
  error: string | null;
  hasFilter: boolean;
  pagination: {
    current: number;
    pageSize: number;
    total: number;
    onChange: (page: number, pageSize?: number) => void;
  };
  exporting: boolean;
  canExport: boolean;
  onExport: () => void;
  onRefresh: () => void;
  onOpenDetail: (id: string) => void;
  onResetFilters: () => void;
}) {
  const columns: Array<AdminColumn<ApiLogView>> = useMemo(
    () => [
      {
        key: 'createdAt',
        title: '时间',
        width: 150,
        render: (row) => formatDateTime(row.createdAt),
      },
      {
        key: 'status',
        title: '状态',
        width: 100,
        render: (row) => (
          <div className="flex flex-col">
            <StatusTag
              status={row.status}
              tone={STATUS_TONES[row.status] ?? 'muted'}
              label={STATUS_LABELS[row.status] ?? row.status}
            />
            <span className={row.statusCode >= 400 ? 'text-danger-text' : undefined}>
              HTTP {row.statusCode || '—'}
            </span>
          </div>
        ),
      },
      {
        key: 'kind',
        title: '类型',
        width: 100,
        render: (row) => (
          <div className="flex flex-col">
            <span>{REQUEST_KIND_LABELS[row.requestKind] ?? row.requestKind}</span>
            <span className={row.billable ? undefined : 'text-warn-text'}>
              {row.billable ? '计费' : '不计费'}
            </span>
          </div>
        ),
      },
      {
        key: 'source',
        title: '来源 / 操作',
        width: 190,
        render: (row) => (
          <div className="min-w-0">
            <div>{(SOURCE_LABELS[row.source] ?? row.source) || '—'}</div>
            <div className="truncate" title={row.operation || undefined}>
              {(OPERATION_LABELS[row.operation] ?? row.operation) || '—'}
            </div>
            <div className="text-xs text-muted-foreground">
              {(CAPABILITY_LABELS[row.capability] ?? row.capability) || '—'}
            </div>
          </div>
        ),
      },
      {
        key: 'channel',
        title: '渠道 / 模型',
        width: 220,
        render: (row) => (
          <div className="min-w-0">
            <div title={row.channelName || row.channelId || undefined}>
              {row.channelName || row.channelId || '—'}
            </div>
            <div className="truncate" title={row.model || undefined}>
              {row.model || '—'}
            </div>
          </div>
        ),
      },
      {
        key: 'usage',
        title: '用量',
        width: 160,
        render: (row) => (
          <div className="flex flex-col">
            <span>
              {formatDuration(row.durationMs)}
              {row.pollCount > 1 ? ` · 轮询 ${row.pollCount}` : ''}
            </span>
            {row.usageAvailable && (
              <span>
                输入 {row.inputTokens} / 输出 {row.outputTokens}
              </span>
            )}
            {row.mediaCount > 0 && <span>产出 {row.mediaCount} 个</span>}
            {row.videoSeconds > 0 && <span>{row.videoSeconds}s 视频</span>}
          </div>
        ),
      },
      {
        key: 'error',
        title: '错误',
        width: 220,
        render: (row) =>
          row.error || row.errorCode ? (
            <div className="min-w-0">
              {row.errorCode && <span className="text-danger-text">{row.errorCode}</span>}
              <span className="ml-1 line-clamp-1" title={row.error}>
                {row.error}
              </span>
            </div>
          ) : (
            <span>—</span>
          ),
      },
      {
        key: 'ops',
        title: '操作',
        width: 80,
        fixed: 'right',
        render: (row) => (
          <ActionButton variant="ghost" size="sm" onClick={() => onOpenDetail(row.id)}>
            详情
          </ActionButton>
        ),
      },
    ],
    [onOpenDetail],
  );

  return (
    <Panel
      title="调用明细"
      extra={
        <>
          {canExport && <ExportCsvButton exporting={exporting} onExport={onExport} />}
          <RefreshButton loading={loading} onRefresh={onRefresh} />
        </>
      }
    >
      {error && rows.length > 0 && <StaleError error={error} onRetry={onRefresh} />}
      <AdminDataTable<ApiLogView>
        rows={rows}
        columns={columns}
        rowKey={(row) => row.id}
        loading={loading}
        error={rows.length === 0 ? error : null}
        onRetry={onRefresh}
        /* 整行可点开详情：只有最右侧「详情」链接时，横向滚动后入口容易被裁掉 */
        onRowClick={(row) => onOpenDetail(row.id)}
        emptyText={
          hasFilter
            ? '没有符合条件的调用记录。清除筛选或换个条件试试。'
            : '没有调用记录。生成任务或执行连通性测试后才会产生记录。'
        }
        emptyAction={
          hasFilter ? (
            <ActionButton variant="secondary" size="sm" onClick={onResetFilters}>
              清除筛选
            </ActionButton>
          ) : undefined
        }
        minWidth={1380}
        pagination={pagination}
      />
    </Panel>
  );
}
