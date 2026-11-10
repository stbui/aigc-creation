import { useCallback, useMemo, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  ActionButton,
  AdminDataTable,
  AppliedFilters,
  ClearableField,
  DateRangeField,
  FilterActions,
  FilterBar,
  Panel,
  RefreshButton,
  SelectField,
  StaleError,
  StatCards,
  StatusTag,
  formatDateTimeLoose,
  formatDuration,
  type AdminColumn,
  type AppliedFilter,
  type TagTone,
} from '~/admin-ui/primitives';
import type { ApiLogListResult, ApiLogView } from '../../../types/model';
import { adminApiLogsApi } from './api';
import { useAdminList, useAdminUrlFilterSync } from './hooks';
import { adminModelCallsHref, adminUserDetailHref } from './utils';

const SOURCE = 'tool';
const OPERATION = 'image_to_prompt';

const STATUS_META: Record<string, { label: string; tone: TagTone }> = {
  success: { label: '成功', tone: 'success' },
  failed: { label: '失败', tone: 'danger' },
  canceled: { label: '已取消', tone: 'muted' },
};

const COLUMNS: Array<AdminColumn<ApiLogView>> = [
  {
    key: 'createdAt',
    title: '时间',
    width: 145,
    render: (row) => (
      <time className="whitespace-nowrap text-[12px] tabular-nums" dateTime={row.createdAt}>
        {formatDateTimeLoose(row.createdAt)}
      </time>
    ),
  },
  {
    key: 'user',
    title: '用户 / 账号',
    width: 190,
    render: (row) => (
      <div className="min-w-0 text-[12px]">
        <div className="truncate text-foreground" title={row.userDisplayName || row.userId}>
          {row.userDisplayName || row.userId || '—'}
        </div>
        {row.userAccount ? (
          <Link
            className="block truncate text-brand hover:underline"
            title={row.userAccount}
            to={adminUserDetailHref(row.userId)}
          >
            {row.userAccount}
          </Link>
        ) : (
          <div className="truncate font-mono text-muted-foreground" title={row.userId}>
            {row.userId || '—'}
          </div>
        )}
      </div>
    ),
  },
  {
    key: 'status',
    title: '状态',
    width: 110,
    render: (row) => {
      const meta = STATUS_META[row.status] ?? { label: row.status || '—', tone: 'muted' as const };
      return (
        <div className="flex flex-col items-start gap-1 text-[12px]">
          <StatusTag status={row.status} label={meta.label} tone={meta.tone} />
          <span className="text-muted-foreground tabular-nums">HTTP {row.statusCode || '—'}</span>
        </div>
      );
    },
  },
  {
    key: 'channel',
    title: '渠道 / 模型',
    width: 210,
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
    key: 'duration',
    title: '耗时',
    width: 90,
    render: (row) => (
      <span className="text-[12px] tabular-nums">{formatDuration(row.durationMs)}</span>
    ),
  },
  {
    key: 'usage',
    title: 'Token 用量',
    width: 150,
    render: (row) =>
      row.usageAvailable ? (
        <div className="flex flex-col text-[12px] tabular-nums text-muted-foreground">
          <span>输入 {row.inputTokens}</span>
          <span>输出 {row.outputTokens}</span>
        </div>
      ) : (
        <span className="text-[12px] text-muted-foreground">无用量数据</span>
      ),
  },
  {
    key: 'error',
    title: '错误',
    width: 220,
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
  {
    key: 'requestId',
    title: '请求号',
    width: 150,
    render: (row) => (
      <span
        className="block truncate font-mono text-[12px] text-muted-foreground"
        title={row.requestId || row.traceId}
      >
        {row.requestId || row.traceId || '—'}
      </span>
    ),
  },
];

/**
 * AI 分析监控：只读展示 `source=tool & operation=image_to_prompt` 的上游调用。
 *
 * 该功能同步返回文字，不创建 GenerationTask，也没有任务轮询 / 重试 / 取消。
 * 调用记录会保存文本预览并折叠图片 base64，但没有任务上下文可供重放；
 * 排障需要完整筛选时跳到调用记录页，仍使用同一份 ApiCallLog 数据。
 */
export function AiAnalysisMonitor() {
  const [searchParams] = useSearchParams();
  const initial = {
    status: searchParams.get('aiStatus') ?? undefined,
    userId: searchParams.get('aiUserId') ?? '',
    from: searchParams.get('aiFrom') ?? '',
    to: searchParams.get('aiTo') ?? '',
  };

  const [status, setStatus] = useState<string | undefined>(initial.status);
  const [userId, setUserId] = useState(initial.userId);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);

  const fetcher = useCallback(
    (params: Record<string, unknown>) =>
      adminApiLogsApi.list({
        source: SOURCE,
        operation: OPERATION,
        status: params.status as string | undefined,
        userId: params.userId as string | undefined,
        from: params.from as string | undefined,
        to: params.to as string | undefined,
        page: params.page as number,
        pageSize: params.pageSize as number,
      }),
    [],
  );

  const { data, loading, error, params, setQuery, setPage, reload } =
    useAdminList<ApiLogListResult>(fetcher, initial);
  useAdminUrlFilterSync({
    aiStatus: params.status as string | undefined,
    aiUserId: params.userId as string | undefined,
    aiFrom: params.from as string | undefined,
    aiTo: params.to as string | undefined,
  });

  const summary = data?.summary;
  const rows = data?.items ?? [];
  const hasFilter = Boolean(params.status || params.userId || params.from || params.to);

  const applyFilters = () =>
    setQuery({
      status,
      userId: userId.trim() || undefined,
      from: from || undefined,
      to: to || undefined,
    });

  const resetFilters = () => {
    setStatus(undefined);
    setUserId('');
    setFrom('');
    setTo('');
    setQuery({ status: undefined, userId: undefined, from: undefined, to: undefined });
  };

  const dateChipLabel = params.from
    ? params.to
      ? `时间：${params.from} ~ ${params.to}`
      : `时间：${params.from} 起`
    : params.to
      ? `时间：截至 ${params.to}`
      : null;

  const appliedChips: AppliedFilter[] = [
    params.status
      ? {
          key: 'status',
          label: `状态：${STATUS_META[params.status as string]?.label ?? params.status}`,
          onClear: () => {
            setStatus(undefined);
            setQuery({ status: undefined });
          },
        }
      : null,
    params.userId
      ? {
          key: 'userId',
          label: `用户：${params.userId}`,
          onClear: () => {
            setUserId('');
            setQuery({ userId: undefined });
          },
        }
      : null,
    dateChipLabel
      ? {
          key: 'date',
          label: dateChipLabel,
          onClear: () => {
            setFrom('');
            setTo('');
            setQuery({ from: undefined, to: undefined });
          },
        }
      : null,
  ].filter(Boolean) as AppliedFilter[];

  const fullRecordsHref = useMemo(
    () => adminModelCallsHref({ source: SOURCE, operation: OPERATION }),
    [],
  );

  return (
    <>
      <StatCards
        columns={4}
        items={[
          {
            label: '分析请求',
            value: summary?.total ?? '—',
            hint: hasFilter ? '当前筛选命中' : '全部上游调用',
          },
          {
            label: '成功',
            value: summary?.success ?? '—',
            hint: '已返回文字结果',
          },
          {
            label: '失败 / 取消',
            value: summary?.failed ?? '—',
            hint: summary?.failed ? '建议查看错误码与请求号' : '暂无失败',
            tone: summary?.failed ? 'danger' : undefined,
          },
          {
            label: '平均耗时',
            value: summary ? formatDuration(summary.avgDurationMs) : '—',
            hint: '按当前筛选统计',
          },
        ]}
        className="mb-3"
      />

      <FilterBar>
        <SelectField
          ariaLabel="AI 分析状态"
          placeholder="全部状态"
          clearLabel="全部状态"
          value={status}
          options={[
            { value: 'success', label: '成功' },
            { value: 'failed', label: '失败' },
            { value: 'canceled', label: '已取消' },
          ]}
          allowClear
          onChange={setStatus}
          className="w-28"
        />
        <ClearableField
          className="w-40"
          ariaLabel="按用户 ID 筛选"
          placeholder="用户 ID"
          value={userId}
          onChange={setUserId}
          onEnter={applyFilters}
        />
        <DateRangeField
          from={from}
          to={to}
          onChange={({ from: nextFrom, to: nextTo }) => {
            setFrom(nextFrom);
            setTo(nextTo);
          }}
          className="w-60"
        />
        <FilterActions>
          <ActionButton variant="default" size="sm" onClick={applyFilters}>
            查询
          </ActionButton>
          <ActionButton variant="secondary" size="sm" onClick={resetFilters}>
            重置
          </ActionButton>
        </FilterActions>
        <AppliedFilters items={appliedChips} onClearAll={resetFilters} />
      </FilterBar>

      <Panel
        title="AI 分析调用"
        note="同步调用只留逐次上游记录，不生成任务；没有任务上下文，故不支持重试或取消。"
        extra={
          <>
            <Link
              className="inline-flex items-center gap-1 whitespace-nowrap text-xs text-brand hover:underline"
              to={fullRecordsHref}
            >
              完整调用记录
              <ExternalLink className="size-3" aria-hidden />
            </Link>
            <RefreshButton loading={loading} onRefresh={reload} />
          </>
        }
      >
        {error && rows.length > 0 && <StaleError error={error} onRetry={() => void reload()} />}
        <AdminDataTable<ApiLogView>
          rows={rows}
          columns={COLUMNS}
          rowKey={(row) => row.id}
          loading={loading}
          error={rows.length === 0 ? error : null}
          onRetry={() => void reload()}
          emptyText={
            hasFilter
              ? '没有符合筛选条件的 AI 分析调用。清除筛选或换个条件试试。'
              : '还没有 AI 分析调用。用户在前台执行图片分析后会出现在这里。'
          }
          emptyAction={
            hasFilter ? (
              <ActionButton variant="secondary" size="sm" onClick={resetFilters}>
                清除筛选
              </ActionButton>
            ) : undefined
          }
          minWidth={1220}
          pagination={{
            current: Number(params.page ?? 1),
            pageSize: Number(params.pageSize ?? 20),
            total: data?.total ?? 0,
            onChange: (page, pageSize) => setPage(page, pageSize),
          }}
        />
      </Panel>
    </>
  );
}
