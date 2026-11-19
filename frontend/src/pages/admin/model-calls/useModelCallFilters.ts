import { useCallback, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { adminApiLogsApi } from './api';
import type { AppliedFilter } from './components';
import { OPERATION_LABELS, REQUEST_KIND_LABELS, SOURCE_LABELS, STATUS_LABELS } from './constants';
import { useAdminList, useAdminUrlFilterSync } from './hooks';
import type { ApiLogListResult, ModelCallFilterValues } from './types';
import { dateChipLabel, hasAnyFilter, readAppliedFilters, readInitialFilters } from './utils';

/** 重置后的空筛选：下拉项 `undefined`、文本项空串，与地址栏初值同形。 */
const EMPTY_FILTERS: ModelCallFilterValues = {
  status: undefined,
  requestKind: undefined,
  source: undefined,
  operation: undefined,
  billable: undefined,
  model: '',
  channelId: '',
  taskId: '',
  userId: '',
  from: '',
  to: '',
};

/**
 * 已生效条件 → 请求参数：原样透传。
 *
 * 不做「空串按未填处理」的归一。首屏无筛选时 `useAdminList` 会把 11 个键一起
 * 放进 `params`（空串），归一与否只影响 URL 上多不多几个空参数，后端对这些
 * 条件本就按 falsy 判空。保持透传是为了让屏幕、地址栏与导出文件三者的口径能
 * 逐字对上，出问题时不必再猜哪一层做过清洗。
 */
function passThrough(params: Record<string, unknown>): ModelCallFilterValues {
  return {
    status: params.status as string | undefined,
    requestKind: params.requestKind as string | undefined,
    source: params.source as string | undefined,
    operation: params.operation as string | undefined,
    billable: params.billable as string | undefined,
    model: params.model as string,
    channelId: params.channelId as string,
    taskId: params.taskId as string,
    userId: params.userId as string,
    from: params.from as string,
    to: params.to as string,
  };
}

/**
 * 调用记录的筛选草稿、已生效条件与 URL 同步。
 *
 * 草稿（`draft`）与已生效（`params`）分开：只在「查询」或回车时提交，避免每键
 * 一次请求。详情 id 不在这里 —— 它与筛选共用同一份地址栏，塞进同一个 hook
 * 会让「写 URL」变成两处竞态。
 */
export function useModelCallFilters() {
  const [searchParams] = useSearchParams();
  const [draft, setDraft] = useState<ModelCallFilterValues>(() => readInitialFilters(searchParams));

  const fetcher = useCallback(
    (params: Record<string, unknown>) =>
      adminApiLogsApi.list({
        ...passThrough(params),
        page: params.page as number,
        pageSize: params.pageSize as number,
      }),
    [],
  );

  const { data, loading, error, params, setQuery, setPage, reload } =
    useAdminList<ApiLogListResult>(fetcher, draft);

  /** 页面内改筛选后回写地址栏；`id`（详情抽屉）由 `useAdminDetailParam` 自己维护 */
  useAdminUrlFilterSync(passThrough(params));

  const applied = readAppliedFilters(params);
  const rows = data?.items ?? [];
  const hasFilter = hasAnyFilter(applied);

  const patchDraft = useCallback((patch: Partial<ModelCallFilterValues>) => {
    setDraft((prev) => ({ ...prev, ...patch }));
  }, []);

  const applyFilters = () => {
    /* 模型 / 渠道 / 任务 / 用户 ID 常从别处复制粘贴，首尾空白不算用户输入 */
    const model = draft.model.trim();
    const channelId = draft.channelId.trim();
    const taskId = draft.taskId.trim();
    const userId = draft.userId.trim();
    setQuery({
      status: draft.status,
      requestKind: draft.requestKind,
      source: draft.source,
      operation: draft.operation,
      billable: draft.billable,
      model: model || undefined,
      channelId: channelId || undefined,
      taskId: taskId || undefined,
      userId: userId || undefined,
      from: draft.from || undefined,
      to: draft.to || undefined,
    });
  };

  const resetFilters = () => {
    setDraft(EMPTY_FILTERS);
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

  /* 逐条撤销：撤一个条件只清一个键，别把其它条件一起清了 */
  const clearStatus = () => {
    patchDraft({ status: undefined });
    setQuery({ status: undefined });
  };
  const clearRequestKind = () => {
    patchDraft({ requestKind: undefined });
    setQuery({ requestKind: undefined });
  };
  const clearSource = () => {
    patchDraft({ source: undefined });
    setQuery({ source: undefined });
  };
  const clearOperation = () => {
    patchDraft({ operation: undefined });
    setQuery({ operation: undefined });
  };
  const clearBillable = () => {
    patchDraft({ billable: undefined });
    setQuery({ billable: undefined });
  };
  const clearModel = () => {
    patchDraft({ model: '' });
    setQuery({ model: undefined });
  };
  const clearChannelId = () => {
    patchDraft({ channelId: '' });
    setQuery({ channelId: undefined });
  };
  const clearTaskId = () => {
    patchDraft({ taskId: '' });
    setQuery({ taskId: undefined });
  };
  const clearUserId = () => {
    patchDraft({ userId: '' });
    setQuery({ userId: undefined });
  };
  const clearDateRange = () => {
    patchDraft({ from: '', to: '' });
    setQuery({ from: undefined, to: undefined });
  };

  /*
   * 已生效条件全部回显成 chip：表格被横向滚动或筛选条换行时，用户仍能一眼看到
   * 「现在到底按什么在查」，并逐条撤掉，不必回头找对应的输入框。
   */
  const dateChip = dateChipLabel(applied.from, applied.to);
  const chipCandidates: Array<AppliedFilter | null> = [
    applied.status
      ? {
          key: 'status',
          label: `状态：${STATUS_LABELS[applied.status] ?? applied.status}`,
          onClear: clearStatus,
        }
      : null,
    applied.requestKind
      ? {
          key: 'requestKind',
          label: `类型：${REQUEST_KIND_LABELS[applied.requestKind] ?? applied.requestKind}`,
          onClear: clearRequestKind,
        }
      : null,
    applied.source
      ? {
          key: 'source',
          label: `来源：${SOURCE_LABELS[applied.source] ?? applied.source}`,
          onClear: clearSource,
        }
      : null,
    applied.operation
      ? {
          key: 'operation',
          label: `操作：${OPERATION_LABELS[applied.operation] ?? applied.operation}`,
          onClear: clearOperation,
        }
      : null,
    applied.billable
      ? {
          key: 'billable',
          label: `计费：${applied.billable === 'true' ? '计费' : '不计费'}`,
          onClear: clearBillable,
        }
      : null,
    applied.model ? { key: 'model', label: `模型：${applied.model}`, onClear: clearModel } : null,
    applied.channelId
      ? {
          key: 'channelId',
          label: `渠道：${applied.channelId}`,
          onClear: clearChannelId,
        }
      : null,
    applied.taskId
      ? { key: 'taskId', label: `任务：${applied.taskId}`, onClear: clearTaskId }
      : null,
    applied.userId
      ? { key: 'userId', label: `用户：${applied.userId}`, onClear: clearUserId }
      : null,
    dateChip ? { key: 'date', label: dateChip, onClear: clearDateRange } : null,
  ];
  const appliedChips = chipCandidates.filter((item): item is AppliedFilter => item !== null);

  return {
    draft,
    patchDraft,
    data,
    loading,
    error,
    rows,
    params,
    hasFilter,
    appliedChips,
    applyFilters,
    resetFilters,
    reload,
    pagination: {
      current: Number(params.page ?? 1),
      pageSize: Number(params.pageSize ?? 20),
      total: data?.total ?? 0,
      onChange: setPage,
    },
  };
}
