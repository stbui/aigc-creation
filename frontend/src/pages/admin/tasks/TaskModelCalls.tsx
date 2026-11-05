import { ExternalLink } from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  AdminDataTable,
  DetailSection,
  StaleError,
  StatusTag,
  type AdminColumn,
  type TagTone,
} from '~/admin-ui/primitives';
import type { ApiLogListResult, ApiLogView } from '../../../types/model';
import { adminApiLogsApi } from './api';
import { useAdminResource } from './hooks';
import { adminModelCallsHref, formatDateTime, formatDuration } from './utils';

const REQUEST_KIND_LABELS: Record<string, string> = {
  create: '创建',
  poll: '轮询',
  task: '连通性测试',
  proxy: '中转',
};

const STATUS_META: Record<string, { label: string; tone: TagTone }> = {
  success: { label: '成功', tone: 'success' },
  failed: { label: '失败', tone: 'danger' },
  canceled: { label: '已取消', tone: 'muted' },
};

const COLUMNS: Array<AdminColumn<ApiLogView>> = [
  {
    key: 'createdAt',
    title: '时间',
    width: 130,
    render: (row) => (
      <time className="text-[12px] whitespace-nowrap tabular-nums" dateTime={row.createdAt}>
        {formatDateTime(row.createdAt)}
      </time>
    ),
  },
  {
    key: 'requestKind',
    title: '类型 / 结果',
    width: 140,
    render: (row) => {
      const meta: { label: string; tone: TagTone } = STATUS_META[row.status] ?? {
        label: row.status || '—',
        tone: 'muted',
      };
      return (
        <div className="flex flex-col items-start gap-1 text-[12px]">
          <span>{REQUEST_KIND_LABELS[row.requestKind] ?? (row.requestKind || '—')}</span>
          <span className="flex items-center gap-1.5">
            <StatusTag status={row.status} label={meta.label} tone={meta.tone} />
            {row.statusCode > 0 && (
              <span className="whitespace-nowrap text-muted-foreground tabular-nums">
                HTTP {row.statusCode}
              </span>
            )}
          </span>
        </div>
      );
    },
  },
  {
    key: 'channel',
    title: '渠道 / 模型',
    width: 180,
    render: (row) => (
      <div className="min-w-0 text-[12px]">
        <div className="truncate text-foreground" title={row.channelName || row.channelId}>
          {row.channelName || row.channelId || '—'}
        </div>
        <div className="truncate font-mono text-muted-foreground" title={row.model}>
          {row.model || '—'}
        </div>
      </div>
    ),
  },
  {
    key: 'usage',
    title: '耗时 / 轮询',
    width: 110,
    render: (row) => (
      <div className="flex flex-col gap-0.5 text-[12px] tabular-nums text-muted-foreground">
        <span>{formatDuration(row.durationMs)}</span>
        {row.pollCount > 0 && <span>轮询 {row.pollCount} 次</span>}
      </div>
    ),
  },
  {
    key: 'error',
    title: '错误',
    width: 180,
    render: (row) =>
      row.errorCode || row.error ? (
        <div className="min-w-0 text-[12px]">
          {row.errorCode && <div className="font-mono text-danger-text">{row.errorCode}</div>}
          {row.error && (
            <div className="line-clamp-2 break-words text-muted-foreground" title={row.error}>
              {row.error}
            </div>
          )}
        </div>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
];

function TaskModelCallsContent({ taskId }: { taskId: string }) {
  const { data, loading, error, reload } = useAdminResource<ApiLogListResult>(
    () => adminApiLogsApi.list({ taskId, page: 1, pageSize: 20 }),
    [taskId],
  );
  const summary = data?.summary;

  return (
    <DetailSection
      title="模型调用"
      note={
        <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
          {summary && (
            <span>
              共 {summary.total} 次 · 成功 {summary.success} · 失败/取消 {summary.failed}
              {summary.total > 0 ? ` · 平均耗时 ${formatDuration(summary.avgDurationMs)}` : ''}
            </span>
          )}
          <Link
            className="inline-flex items-center gap-1 text-brand hover:underline"
            to={adminModelCallsHref({ taskId })}
          >
            查看全部调用
            <ExternalLink className="size-3" aria-hidden />
          </Link>
        </span>
      }
    >
      <div className="flex flex-col gap-2">
        {error && data && <StaleError error={error} onRetry={() => void reload()} />}
        <AdminDataTable<ApiLogView>
          rows={data?.items ?? []}
          columns={COLUMNS}
          rowKey={(row) => row.id}
          loading={loading}
          error={data ? null : error}
          onRetry={() => void reload()}
          emptyText="该任务尚无上游调用"
          minWidth={720}
        />
      </div>
    </DetailSection>
  );
}

/**
 * 任务详情中的模型调用摘要。
 *
 * 无权限时不挂载数据组件，避免仅靠视觉隐藏却仍向后端发请求。完整列表仍在
 * `/admin/model-calls`，这里只取最近 20 条用于定位失败发生在哪次上游调用。
 */
export function TaskModelCalls({ taskId, canRead }: { taskId: string; canRead: boolean }) {
  if (!canRead) return null;
  return <TaskModelCallsContent key={taskId} taskId={taskId} />;
}
