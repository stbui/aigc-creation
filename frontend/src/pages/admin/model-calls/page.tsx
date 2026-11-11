import { useCallback, useMemo, useState } from 'react';
import {
  BILLABLE_OPTIONS,
  CAPABILITY_LABELS,
  OPERATION_LABELS,
  OPERATION_OPTIONS,
  REQUEST_KIND_LABELS,
  REQUEST_KIND_OPTIONS,
  SOURCE_LABELS,
  SOURCE_OPTIONS,
  STATUS_LABELS,
  STATUS_OPTIONS,
  STATUS_TONES,
} from './constants';
import { useAdmin, useToast, useAdminDetailParam, useAdminList, useAdminUrlFilterSync } from './hooks';
import { useSearchParams } from 'react-router-dom';
import { adminApiLogsApi } from '../../../lib/api';
import { ModelCallDetailDrawer } from './ModelCallDetailDrawer';

import {
  AdminPage,
  ActionButton,
  RefreshButton,
  ExportCsvButton,
  useAdminExport,
  AdminDataTable,
  AppliedFilters,
  ClearableField,
  DateRangeField,
  FilterActions,
  FilterBar,
  Panel,
  SelectField,
  StatusTag,
  StaleError,
  formatDateTime,
  formatDuration,
  type AdminColumn,
  type AppliedFilter,
} from '~/admin-ui/primitives';
import type { ApiLogListResult, ApiLogView } from '../../../types/model';

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

export function AdminModelCallsPage() {
  /*
   * 筛选条件可从地址栏恢复：把结果页链接发给同事时，对方打开必须是同一份数据。
   * 读取放在 useState 初始化里同步完成，避免先按空条件查一次再查第二次。
   */
  const [searchParams] = useSearchParams();
  const initial = {
    status: searchParams.get('status') ?? undefined,
    requestKind: searchParams.get('requestKind') ?? undefined,
    source: searchParams.get('source') ?? undefined,
    operation: searchParams.get('operation') ?? undefined,
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
  const [source, setSource] = useState<string | undefined>(initial.source);
  const [operation, setOperation] = useState<string | undefined>(initial.operation);
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
        source: params.source as string | undefined,
        operation: params.operation as string | undefined,
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

  const { data, loading, error, params, setQuery, setPage, reload } = useAdminList<ApiLogListResult>(fetcher, initial);
  /** 页面内改筛选后回写地址栏；`id`（详情抽屉）由 `useAdminDetailParam` 自己维护 */
  useAdminUrlFilterSync({
    status: params.status as string | undefined,
    requestKind: params.requestKind as string | undefined,
    source: params.source as string | undefined,
    operation: params.operation as string | undefined,
    billable: params.billable as string | undefined,
    model: params.model as string | undefined,
    channelId: params.channelId as string | undefined,
    taskId: params.taskId as string | undefined,
    userId: params.userId as string | undefined,
    from: params.from as string | undefined,
    to: params.to as string | undefined,
  });
  const rows = data?.items ?? [];
  /** 任一筛选生效：空态文案与「清除筛选」入口据此切换 */
  const hasFilter = [
    params.status,
    params.requestKind,
    params.source,
    params.operation,
    params.billable,
    params.model,
    params.channelId,
    params.taskId,
    params.userId,
    params.from,
    params.to,
  ].some(Boolean);

  const { can } = useAdmin();
  const toast = useToast();
  const { exporting, runExport } = useAdminExport(toast);

  /** 导出走当前筛选条件 —— 文件的筛选口径必须与屏幕上看到的一致 */
  const exportCsv = () =>
    runExport(
      () =>
        adminApiLogsApi.exportCsv({
          status: params.status as string | undefined,
          requestKind: params.requestKind as string | undefined,
          source: params.source as string | undefined,
          operation: params.operation as string | undefined,
          billable: params.billable as string | undefined,
          model: params.model as string | undefined,
          channelId: params.channelId as string | undefined,
          taskId: params.taskId as string | undefined,
          userId: params.userId as string | undefined,
          from: params.from as string | undefined,
          to: params.to as string | undefined,
        }),
      '导出已开始下载',
    );

  const [detailId, setDetailId] = useAdminDetailParam();
  const detail = rows.find((row) => row.id === detailId) ?? null;

  const applyFilters = () =>
    setQuery({
      status,
      requestKind,
      source,
      operation,
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
    setSource(undefined);
    setOperation(undefined);
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
      source: undefined,
      operation: undefined,
      billable: undefined,
      model: undefined,
      channelId: undefined,
      taskId: undefined,
      userId: undefined,
      from: undefined,
      to: undefined,
    });
  };

  /*
   * 已生效条件全部回显成 chip：表格被横向滚动或筛选条换行时，用户仍能一眼看到
   * 「现在到底按什么在查」，并逐条撤掉，不必回头找对应的输入框。
   */
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
    params.source
      ? {
          key: 'source',
          label: `来源：${SOURCE_LABELS[params.source as string] ?? params.source}`,
          onClear: () => {
            setSource(undefined);
            setQuery({ source: undefined });
          },
        }
      : null,
    params.operation
      ? {
          key: 'operation',
          label: `操作：${OPERATION_LABELS[params.operation as string] ?? params.operation}`,
          onClear: () => {
            setOperation(undefined);
            setQuery({ operation: undefined });
          },
        }
      : null,
    params.billable
      ? {
          key: 'billable',
          label: `计费：${params.billable === 'true' ? '计费' : '不计费'}`,
          onClear: () => {
            setBillable(undefined);
            setQuery({ billable: undefined });
          },
        }
      : null,
    params.model
      ? {
          key: 'model',
          label: `模型：${params.model}`,
          onClear: () => {
            setModel('');
            setQuery({ model: undefined });
          },
        }
      : null,
    params.channelId
      ? {
          key: 'channelId',
          label: `渠道：${params.channelId}`,
          onClear: () => {
            setChannelId('');
            setQuery({ channelId: undefined });
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
          <ActionButton variant="ghost" size="sm" onClick={() => setDetailId(row.id)}>
            详情
          </ActionButton>
        ),
      },
    ],
    [setDetailId],
  );

  return (
    <AdminPage
      title="调用记录"
      description="逐次留痕的上游 HTTP 调用，含后台连通性测试（不计费）。排查「哪个请求失败、返回了什么」看这里。"
    >

       <FilterBar>
          <SelectField
            ariaLabel="调用状态"
            clearLabel="全部状态"
            value={status}
            options={STATUS_OPTIONS}
            allowClear
            onChange={setStatus}
            className="w-28"
          />
          <SelectField
            ariaLabel="请求类型"
            clearLabel="全部类型"
            value={requestKind}
            options={REQUEST_KIND_OPTIONS}
            allowClear
            onChange={setRequestKind}
            className="w-32"
          />
          <SelectField
            ariaLabel="调用来源"
            clearLabel="全部来源"
            value={source}
            options={SOURCE_OPTIONS}
            allowClear
            onChange={setSource}
            className="w-36"
          />
          <SelectField
            ariaLabel="调用操作"
            clearLabel="全部操作"
            value={operation}
            options={OPERATION_OPTIONS}
            allowClear
            onChange={setOperation}
            className="w-52"
          />
          <SelectField
            ariaLabel="是否计费"
            clearLabel="全部计费"
            value={billable}
            options={BILLABLE_OPTIONS}
            allowClear
            onChange={setBillable}
            className="w-32"
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
          {/* 精确定位用的 ID 输入排在常用条件之后，窄屏时自然换到第二行 */}
          <ClearableField
            ariaLabel="模型"
            value={model}
            onChange={setModel}
            placeholder="模型编码"
            onEnter={applyFilters}
            className="w-40"
          />
          <ClearableField
            ariaLabel="渠道 ID"
            value={channelId}
            onChange={setChannelId}
            placeholder="渠道 ID"
            onEnter={applyFilters}
            className="w-40"
          />
          <ClearableField
            ariaLabel="任务 ID"
            value={taskId}
            onChange={setTaskId}
            placeholder="任务 ID"
            onEnter={applyFilters}
            className="w-40"
          />
          <ClearableField
            ariaLabel="用户 ID"
            value={userId}
            onChange={setUserId}
            placeholder="用户 ID"
            onEnter={applyFilters}
            className="w-40"
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
        title="调用明细"
        extra={
          <>
            {can('data.export') && <ExportCsvButton exporting={exporting} onExport={exportCsv} />}
            <RefreshButton loading={loading} onRefresh={reload} />
          </>
        }
      >
        {error && rows.length > 0 && <StaleError error={error} onRetry={() => void reload()} />}
        <AdminDataTable<ApiLogView>
          rows={rows}
          columns={columns}
          rowKey={(row) => row.id}
          loading={loading}
          error={rows.length === 0 ? error : null}
          onRetry={() => void reload()}
          /* 整行可点开详情：只有最右侧「详情」链接时，横向滚动后入口容易被裁掉 */
          onRowClick={(row) => setDetailId(row.id)}
          emptyText={
            hasFilter
              ? '没有符合条件的调用记录。清除筛选或换个条件试试。'
              : '没有调用记录。生成任务或执行连通性测试后才会产生记录。'
          }
          emptyAction={
            hasFilter ? (
              <ActionButton variant="secondary" size="sm" onClick={resetFilters}>
                清除筛选
              </ActionButton>
            ) : undefined
          }
          minWidth={1380}
          pagination={{
            current: Number(params.page ?? 1),
            pageSize: Number(params.pageSize ?? 20),
            total: data?.total ?? 0,
            onChange: (page, pageSize) => setPage(page, pageSize),
          }}
        />
      </Panel>

      <ModelCallDetailDrawer detailId={detailId} detail={detail} onClose={() => setDetailId(null)} />
    </AdminPage>
  );
}
