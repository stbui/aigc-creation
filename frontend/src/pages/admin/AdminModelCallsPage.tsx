import { useCallback, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Download } from 'lucide-react';
import { adminApiLogsApi } from '../../lib/api';
import { useAdmin } from '../../context/AdminContext';
import { useToast } from '../../admin-ui/providers/ToastProvider';
import {
  ActionButton,
  AdminDataTable,
  AppliedFilters,
  Descriptions,
  Drawer,
  FilterActions,
  FilterBar,
  Notice,
  PageHeader,
  Panel,
  SelectField,
  StatCard,
  StatusTag,
  StaleError,
  TextField,
  useAdminDetailParam,
  useAdminList,
  useAdminUrlFilterSync,
  type AdminColumn,
  type AppliedFilter,
} from '../../admin-ui/primitives';
import type { ApiLogListResult, ApiLogView } from '../../types/model';

/**
 * 上游调用记录（`/admin/model-calls`，数据源 `/admin/api-logs`）。
 *
 * 一条记录 = 一次真实的上游 HTTP 调用，包括后台连通性测试（`billable=false`）。
 * 与「生成账单」的区别：账单按任务聚合（一次任务可能包含创建 + 多次轮询），
 * 调用记录逐次留痕，排查「到底哪个请求失败了、返回了什么」看这里。
 *
 * 旧的 `ModelCallLog` 视图随 `src/providers/**` 在 P6 删除；本页已切到
 * `ApiCallLog`，两条链路不能共用同一路径。
 */

const REQUEST_KIND_LABELS: Record<string, string> = {
  create: '创建',
  poll: '轮询',
  task: '连通性测试',
  proxy: '中转',
};

const STATUS_LABELS: Record<string, string> = {
  success: '成功',
  failed: '失败',
  canceled: '已取消',
};

const STATUS_TONES: Record<string, 'success' | 'danger' | 'warn' | 'brand' | 'muted'> = {
  success: 'success',
  failed: 'danger',
  canceled: 'muted',
};

export function AdminModelCallsPage() {
  /*
   * 筛选条件可从地址栏恢复：把结果页链接发给同事时，对方打开必须是同一份数据。
   * 读取放在 useState 初始化里同步完成，避免先按空条件查一次再查第二次。
   */
  const [searchParams] = useSearchParams();
  const initial = {
    status: searchParams.get('status') ?? undefined,
    requestKind: searchParams.get('requestKind') ?? undefined,
    billable: searchParams.get('billable') ?? undefined,
    model: searchParams.get('model') ?? '',
    channelId: searchParams.get('channelId') ?? '',
    taskId: searchParams.get('taskId') ?? '',
    userId: searchParams.get('userId') ?? '',
    from: searchParams.get('from') ?? '',
    to: searchParams.get('to') ?? '',
  };

  const [status, setStatus] = useState<string | undefined>(initial.status);
  const [requestKind, setRequestKind] = useState<string | undefined>(initial.requestKind);
  const [billable, setBillable] = useState<string | undefined>(initial.billable);
  const [model, setModel] = useState(initial.model);
  const [channelId, setChannelId] = useState(initial.channelId);
  const [taskId, setTaskId] = useState(initial.taskId);
  const [userId, setUserId] = useState(initial.userId);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);

  const fetcher = useCallback(
    (params: Record<string, unknown>) =>
      adminApiLogsApi.list({
        status: params.status as string | undefined,
        requestKind: params.requestKind as string | undefined,
        billable: params.billable as string | undefined,
        model: params.model as string | undefined,
        channelId: params.channelId as string | undefined,
        taskId: params.taskId as string | undefined,
        userId: params.userId as string | undefined,
        from: params.from as string | undefined,
        to: params.to as string | undefined,
        page: params.page as number,
        pageSize: params.pageSize as number,
      }),
    [],
  );

  const { data, loading, error, params, setQuery, setPage, reload } = useAdminList<ApiLogListResult>(
    fetcher,
    initial,
  );
  /** 页面内改筛选后回写地址栏；`id`（详情抽屉）由 `useAdminDetailParam` 自己维护 */
  useAdminUrlFilterSync({
    status: params.status as string | undefined,
    requestKind: params.requestKind as string | undefined,
    billable: params.billable as string | undefined,
    model: params.model as string | undefined,
    channelId: params.channelId as string | undefined,
    taskId: params.taskId as string | undefined,
    userId: params.userId as string | undefined,
    from: params.from as string | undefined,
    to: params.to as string | undefined,
  });
  const rows = data?.items ?? [];
  const summary = data?.summary;

  const { can } = useAdmin();
  const toast = useToast();
  const [exporting, setExporting] = useState(false);

  /** 导出走当前筛选条件 —— 文件的筛选口径必须与屏幕上看到的一致 */
  const exportCsv = async () => {
    setExporting(true);
    try {
      await adminApiLogsApi.exportCsv({
        status: params.status as string | undefined,
        requestKind: params.requestKind as string | undefined,
        billable: params.billable as string | undefined,
        model: params.model as string | undefined,
        channelId: params.channelId as string | undefined,
        taskId: params.taskId as string | undefined,
        userId: params.userId as string | undefined,
        from: params.from as string | undefined,
        to: params.to as string | undefined,
      });
      toast.success('导出已开始下载');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '导出失败');
    } finally {
      setExporting(false);
    }
  };

  const [detailId, setDetailId] = useAdminDetailParam();
  const detail = rows.find((row) => row.id === detailId) ?? null;

  const applyFilters = () =>
    setQuery({
      status,
      requestKind,
      billable,
      model: model.trim() || undefined,
      channelId: channelId.trim() || undefined,
      taskId: taskId.trim() || undefined,
      userId: userId.trim() || undefined,
      from: from || undefined,
      to: to || undefined,
    });

  const resetFilters = () => {
    setStatus(undefined);
    setRequestKind(undefined);
    setBillable(undefined);
    setModel('');
    setChannelId('');
    setTaskId('');
    setUserId('');
    setFrom('');
    setTo('');
    setQuery({
      status: undefined,
      requestKind: undefined,
      billable: undefined,
      model: undefined,
      channelId: undefined,
      taskId: undefined,
      userId: undefined,
      from: undefined,
      to: undefined,
    });
  };

  const appliedChips: AppliedFilter[] = [
    params.status
      ? {
          key: 'status',
          label: `状态：${STATUS_LABELS[params.status as string] ?? params.status}`,
          onClear: () => {
            setStatus(undefined);
            setQuery({ status: undefined });
          },
        }
      : null,
    params.requestKind
      ? {
          key: 'requestKind',
          label: `类型：${REQUEST_KIND_LABELS[params.requestKind as string] ?? params.requestKind}`,
          onClear: () => {
            setRequestKind(undefined);
            setQuery({ requestKind: undefined });
          },
        }
      : null,
    params.taskId
      ? {
          key: 'taskId',
          label: `任务：${params.taskId}`,
          onClear: () => {
            setTaskId('');
            setQuery({ taskId: undefined });
          },
        }
      : null,
  ].filter(Boolean) as AppliedFilter[];

  const columns: Array<AdminColumn<ApiLogView>> = useMemo(
    () => [
      {
        key: 'createdAt',
        title: '时间',
        width: 150,
        render: (row) => (
          <span className="text-[11px] tabular-nums text-muted-foreground">
            {new Date(row.createdAt).toLocaleString('zh-CN')}
          </span>
        ),
      },
      {
        key: 'status',
        title: '状态',
        width: 100,
        render: (row) => (
          <div className="flex flex-col gap-0.5 text-[11px]">
            <StatusTag
              status={row.status}
              tone={STATUS_TONES[row.status] ?? 'muted'}
              label={STATUS_LABELS[row.status] ?? row.status}
            />
            <span className="tabular-nums text-muted-foreground">HTTP {row.statusCode || '—'}</span>
          </div>
        ),
      },
      {
        key: 'kind',
        title: '类型',
        width: 100,
        render: (row) => (
          <div className="flex flex-col gap-0.5 text-[11px]">
            <span className="text-foreground">{REQUEST_KIND_LABELS[row.requestKind] ?? row.requestKind}</span>
            <span className={row.billable ? 'text-muted-foreground' : 'text-warn-text'}>
              {row.billable ? '计费' : '不计费'}
            </span>
          </div>
        ),
      },
      {
        key: 'channel',
        title: '渠道 / 模型',
        width: 220,
        render: (row) => (
          <div className="min-w-0">
            <div className="truncate text-[11px] text-foreground">{row.channelName || row.channelId || '—'}</div>
            <div className="truncate font-mono text-[10px] text-muted-foreground">{row.model || '—'}</div>
          </div>
        ),
      },
      {
        key: 'usage',
        title: '用量',
        width: 160,
        render: (row) => (
          <div className="flex flex-col gap-0.5 text-[11px] tabular-nums text-muted-foreground">
            <span>{row.durationMs} ms{row.pollCount > 1 ? ` · 轮询 ${row.pollCount}` : ''}</span>
            {row.usageAvailable && (
              <span className="text-muted-foreground">
                输入 {row.inputTokens} / 输出 {row.outputTokens}
              </span>
            )}
            {row.mediaCount > 0 && <span className="text-muted-foreground">产出 {row.mediaCount} 个</span>}
            {row.videoSeconds > 0 && <span className="text-muted-foreground">{row.videoSeconds}s 视频</span>}
          </div>
        ),
      },
      {
        key: 'error',
        title: '错误',
        width: 220,
        render: (row) =>
          row.error || row.errorCode ? (
            <div className="min-w-0 text-[11px]">
              {row.errorCode && <span className="font-mono text-danger-text">{row.errorCode}</span>}
              <span className="ml-1 line-clamp-1 text-muted-foreground" title={row.error}>
                {row.error}
              </span>
            </div>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        key: 'ops',
        title: '操作',
        width: 80,
        fixed: 'right',
        render: (row) => (
          <ActionButton variant="ghost" size="xs" onClick={() => setDetailId(row.id)}>
            详情
          </ActionButton>
        ),
      },
    ],
    [setDetailId],
  );

  return (
    <>
      <PageHeader
        title="调用记录"
        description="逐次留痕的上游 HTTP 调用，含后台连通性测试（不计费）。排查「哪个请求失败、返回了什么」看这里。"
        actions={
          <>
            {can('data.export') && (
              <ActionButton
                variant="secondary"
                size="sm"
                icon={Download}
                disabled={exporting}
                onClick={() => void exportCsv()}
              >
                {exporting ? '导出中…' : '导出 CSV'}
              </ActionButton>
            )}
            <ActionButton variant="secondary" size="sm" onClick={() => void reload()}>
              刷新
            </ActionButton>
          </>
        }
      />

      {summary && (
        <div className="mb-3 grid grid-cols-4 gap-3">
          <StatCard label="调用总数" value={summary.total} hint="受当前筛选影响" />
          <StatCard label="成功" value={summary.success} tone={undefined} />
          <StatCard label="失败 / 取消" value={summary.failed} tone={summary.failed > 0 ? 'danger' : undefined} />
          <StatCard label="平均耗时" value={`${summary.avgDurationMs} ms`} hint={`其它状态 ${summary.other} 条`} />
        </div>
      )}

      <Panel title="调用明细">
        <FilterBar>
          <SelectField
            ariaLabel="调用状态"
            value={status}
            options={[
              { value: 'success', label: '成功' },
              { value: 'failed', label: '失败' },
              { value: 'canceled', label: '已取消' },
            ]}
            allowClear
            onChange={setStatus}
          />
          <SelectField
            ariaLabel="请求类型"
            value={requestKind}
            options={[
              { value: 'create', label: '创建' },
              { value: 'poll', label: '轮询' },
              { value: 'task', label: '连通性测试' },
            ]}
            allowClear
            onChange={setRequestKind}
          />
          <SelectField
            ariaLabel="是否计费"
            value={billable}
            options={[
              { value: 'true', label: '计费' },
              { value: 'false', label: '不计费' },
            ]}
            allowClear
            onChange={setBillable}
          />
          <TextField ariaLabel="模型" value={model} onChange={setModel} placeholder="模型编码" onEnter={applyFilters} />
          <TextField
            ariaLabel="渠道 ID"
            value={channelId}
            onChange={setChannelId}
            placeholder="渠道 ID"
            onEnter={applyFilters}
          />
          <TextField ariaLabel="任务 ID" value={taskId} onChange={setTaskId} placeholder="任务 ID" onEnter={applyFilters} />
          <TextField ariaLabel="用户 ID" value={userId} onChange={setUserId} placeholder="用户 ID" onEnter={applyFilters} />
          <TextField ariaLabel="开始日期" type="date" value={from} onChange={setFrom} />
          <TextField ariaLabel="结束日期" type="date" value={to} onChange={setTo} />
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

        {error && rows.length > 0 && <StaleError error={error} onRetry={() => void reload()} />}
        <AdminDataTable<ApiLogView>
          rows={rows}
          columns={columns}
          rowKey={(row) => row.id}
          loading={loading}
          error={rows.length === 0 ? error : null}
          onRetry={() => void reload()}
          emptyText="没有调用记录。生成任务或执行连通性测试后才会产生记录。"
          minWidth={1180}
          pagination={{
            current: Number(params.page ?? 1),
            pageSize: Number(params.pageSize ?? 20),
            total: data?.total ?? 0,
            onChange: (page, pageSize) => setPage(page, pageSize),
          }}
        />
      </Panel>

      <Drawer
        open={detailId !== null}
        onOpenChange={(open) => {
          if (!open) setDetailId(null);
        }}
        width={720}
        title="调用详情"
        description={detail ? `${detail.method} ${detail.path}` : undefined}
        footer={
          <ActionButton variant="secondary" size="sm" onClick={() => setDetailId(null)}>
            关闭
          </ActionButton>
        }
      >
        {detail ? (
          <div className="flex flex-col gap-4">
            {detail.error && (
              <Notice tone="danger" title={`调用失败${detail.errorCode ? `（${detail.errorCode}）` : ''}`}>
                {detail.error}
              </Notice>
            )}
            <Descriptions
              items={[
                { label: '状态', value: `${STATUS_LABELS[detail.status] ?? detail.status} · HTTP ${detail.statusCode || '—'}` },
                { label: '请求类型', value: `${REQUEST_KIND_LABELS[detail.requestKind] ?? detail.requestKind}${detail.billable ? '（计费）' : '（不计费）'}` },
                { label: '来源', value: detail.source || '—' },
                { label: '渠道', value: `${detail.channelName || '—'}（${detail.channelId || '—'}）` },
                { label: '模型', value: <span className="font-mono text-xs">{detail.model || '—'}</span> },
                { label: '协议 / 格式', value: detail.apiFormat || '—' },
                { label: '能力 / 操作', value: `${detail.capability || '—'} · ${detail.operation || '—'}` },
                { label: '耗时', value: `${detail.durationMs} ms${detail.pollCount > 0 ? ` · 第 ${detail.pollCount} 次轮询` : ''}` },
                { label: '上游状态', value: detail.providerStatus || '—' },
                { label: '请求方法', value: <span className="font-mono text-xs">{detail.method || '—'}</span> },
                { label: '请求路径', value: <span className="break-all font-mono text-xs">{detail.path || '—'}</span> },
                { label: '上游请求号', value: <span className="font-mono text-xs">{detail.providerRequestId || '—'}</span> },
                { label: '任务', value: <span className="font-mono text-xs">{detail.taskId || '—'}</span> },
                { label: '账单', value: <span className="font-mono text-xs">{detail.billingOrderId || '—'}</span> },
                { label: '用户', value: detail.userId || '—' },
                { label: '追踪号', value: <span className="font-mono text-xs">{detail.traceId || '—'}</span> },
                {
                  label: 'Token 用量',
                  value: detail.usageAvailable
                    ? `输入 ${detail.inputTokens} · 输出 ${detail.outputTokens} · 缓存 ${detail.cachedTokens}`
                    : '无用量数据',
                },
                { label: '产出', value: `${detail.mediaCount} 个媒体${detail.videoSeconds > 0 ? ` · ${detail.videoSeconds}s` : ''}` },
                { label: '时间', value: new Date(detail.createdAt).toLocaleString('zh-CN') },
              ]}
              columns={2}
            />
          </div>
        ) : (
          <p className="py-6 text-center text-xs text-muted-foreground">
            该记录不在当前页。请回到列表按任务 ID 或渠道 ID 定位。
          </p>
        )}
      </Drawer>
    </>
  );
}
