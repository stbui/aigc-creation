import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { AppliedFilter, SelectFieldOption } from '~/admin-ui/primitives';
import { adminTasksApi } from './api';
import { STATUS_OPTIONS } from './constants';
import { useAdminList, useAdminUrlFilterSync, useToast } from './hooks';
import type { AdminTaskListResult } from '../../../types/api';

const STATUS_VALUES = new Set(STATUS_OPTIONS.map((option) => option.value));

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function numberValue(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function readStatus(params: URLSearchParams): string | undefined {
  const value = params.get('status') ?? undefined;
  return value && STATUS_VALUES.has(value) ? value : undefined;
}

interface UseTaskFiltersOptions {
  /** 已生效查询变化时通知页面清理跨页选择。 */
  onQueryChange?: () => void;
}

/**
 * 任务列表的筛选、URL 同步、分面选项与导出。
 *
 * 输入草稿与已生效查询分离：下拉和输入框改动不会立即发请求，只有「查询」
 * 或回车才提交。URL 只同步已生效条件，刷新、深链和浏览器前进后退都能恢复。
 */
export function useTaskFilters({ onQueryChange }: UseTaskFiltersOptions = {}) {
  const toast = useToast();
  const [searchParams] = useSearchParams();

  const initialStatus = readStatus(searchParams);
  const initialCapability = searchParams.get('capability') ?? undefined;
  const initialOwner = searchParams.get('userId') ?? '';
  const initialProject = searchParams.get('projectId') ?? '';
  const initialErrorCode = searchParams.get('errorCode') ?? '';
  const initialFrom = searchParams.get('from') ?? '';
  const initialTo = searchParams.get('to') ?? '';

  const [status, setStatus] = useState<string | undefined>(initialStatus);
  const [capability, setCapability] = useState<string | undefined>(initialCapability);
  const [owner, setOwner] = useState(initialOwner);
  const [project, setProject] = useState(initialProject);
  const [errorCode, setErrorCode] = useState(initialErrorCode);
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);
  const [exporting, setExporting] = useState(false);
  const exportingRef = useRef(false);
  const appliedUrlStatus = useRef<string | undefined>(initialStatus);
  const appliedUrlProject = useRef(initialProject);
  const onQueryChangeRef = useRef(onQueryChange);
  onQueryChangeRef.current = onQueryChange;

  const notifyQueryChange = useCallback(() => {
    onQueryChangeRef.current?.();
  }, []);

  const fetcher = useCallback((raw: Record<string, unknown>) => {
    return adminTasksApi.list({
      page: numberValue(raw.page, 1),
      pageSize: numberValue(raw.pageSize, 20),
      status: stringValue(raw.status),
      capability: stringValue(raw.capability),
      userId: stringValue(raw.userId),
      projectId: stringValue(raw.projectId),
      errorCode: stringValue(raw.errorCode),
      from: stringValue(raw.from),
      to: stringValue(raw.to),
      sort: stringValue(raw.sort),
    });
  }, []);

  const { data, loading, error, params, setQuery, setPage, reload } =
    useAdminList<AdminTaskListResult>(fetcher, {
      sort: 'createdAt:desc',
      ...(initialStatus ? { status: initialStatus } : {}),
      ...(initialCapability ? { capability: initialCapability } : {}),
      ...(initialOwner ? { userId: initialOwner } : {}),
      ...(initialProject ? { projectId: initialProject } : {}),
      ...(initialErrorCode ? { errorCode: initialErrorCode } : {}),
      ...(initialFrom ? { from: initialFrom } : {}),
      ...(initialTo ? { to: initialTo } : {}),
    });

  /* 告警中心链接只改 URL 时，已在本页也要把筛选同步过去。 */
  useEffect(() => {
    const next = readStatus(searchParams);
    if (next === appliedUrlStatus.current) return;
    appliedUrlStatus.current = next;
    setStatus(next);
    notifyQueryChange();
    setQuery({ status: next });
  }, [searchParams, setQuery, notifyQueryChange]);

  /* 任务详情里的项目入口与列表同页：URL 变了要同步筛选。 */
  useEffect(() => {
    const next = searchParams.get('projectId') ?? '';
    if (next === appliedUrlProject.current) return;
    appliedUrlProject.current = next;
    setProject(next);
    notifyQueryChange();
    setQuery({ projectId: next || undefined });
  }, [searchParams, setQuery, notifyQueryChange]);

  useAdminUrlFilterSync({
    status: stringValue(params.status),
    capability: stringValue(params.capability),
    userId: stringValue(params.userId),
    projectId: stringValue(params.projectId),
    errorCode: stringValue(params.errorCode),
    from: stringValue(params.from),
    to: stringValue(params.to),
  });

  const capOptions = useMemo<SelectFieldOption[]>(
    () =>
      (data?.capabilities ?? []).map((item) => ({
        value: item.capability,
        label: `${item.capability}（${item.count}）`,
      })),
    [data],
  );

  const appliedStatus = stringValue(params.status);
  const appliedCapability = stringValue(params.capability);
  const appliedOwner = stringValue(params.userId) ?? '';
  const appliedProject = stringValue(params.projectId) ?? '';
  const appliedErrorCode = stringValue(params.errorCode) ?? '';
  const appliedFrom = stringValue(params.from) ?? '';
  const appliedTo = stringValue(params.to) ?? '';
  const sort = stringValue(params.sort) ?? 'createdAt:desc';

  /** 空态与结果卡按已生效查询判断，输入框里尚未提交的草稿不算。 */
  const hasFilter = Boolean(
    appliedStatus ||
      appliedCapability ||
      appliedOwner ||
      appliedProject ||
      appliedErrorCode ||
      appliedFrom ||
      appliedTo,
  );

  const applyFilters = () => {
    const nextProject = project.trim();
    appliedUrlStatus.current = status;
    appliedUrlProject.current = nextProject;
    notifyQueryChange();
    setQuery({
      status,
      capability,
      userId: owner.trim() || undefined,
      projectId: nextProject || undefined,
      errorCode: errorCode.trim() || undefined,
      // datetime-local 的值没有时区，后端 parseDate 与本机 new Date() 口径一致。
      from: from || undefined,
      to: to || undefined,
    });
  };

  const resetFilters = () => {
    appliedUrlStatus.current = undefined;
    appliedUrlProject.current = '';
    setStatus(undefined);
    setCapability(undefined);
    setOwner('');
    setProject('');
    setErrorCode('');
    setFrom('');
    setTo('');
    notifyQueryChange();
    setQuery({
      status: undefined,
      capability: undefined,
      userId: undefined,
      projectId: undefined,
      errorCode: undefined,
      from: undefined,
      to: undefined,
    });
  };

  /** 应用保存视图：草稿与已生效查询一次性覆盖，避免两次 setState 读到旧值。 */
  const applyView = (next: {
    status?: string;
    capability?: string;
    userId?: string;
    projectId?: string;
    errorCode?: string;
    from?: string;
    to?: string;
  }) => {
    appliedUrlStatus.current = next.status;
    appliedUrlProject.current = next.projectId ?? '';
    setStatus(next.status);
    setCapability(next.capability);
    setOwner(next.userId ?? '');
    setProject(next.projectId ?? '');
    setErrorCode(next.errorCode ?? '');
    setFrom(next.from ?? '');
    setTo(next.to ?? '');
    notifyQueryChange();
    setQuery({
      status: next.status,
      capability: next.capability,
      userId: next.userId,
      projectId: next.projectId,
      errorCode: next.errorCode,
      from: next.from,
      to: next.to,
    });
  };

  const clearStatus = () => {
    appliedUrlStatus.current = undefined;
    setStatus(undefined);
    notifyQueryChange();
    setQuery({ status: undefined });
  };
  const clearCapability = () => {
    setCapability(undefined);
    notifyQueryChange();
    setQuery({ capability: undefined });
  };
  const clearOwner = () => {
    setOwner('');
    notifyQueryChange();
    setQuery({ userId: undefined });
  };
  const clearProject = () => {
    appliedUrlProject.current = '';
    setProject('');
    notifyQueryChange();
    setQuery({ projectId: undefined });
  };
  const clearErrorCode = () => {
    setErrorCode('');
    notifyQueryChange();
    setQuery({ errorCode: undefined });
  };
  const clearFrom = () => {
    setFrom('');
    notifyQueryChange();
    setQuery({ from: undefined });
  };
  const clearTo = () => {
    setTo('');
    notifyQueryChange();
    setQuery({ to: undefined });
  };

  const appliedChipCandidates: Array<AppliedFilter | null> = [
    appliedStatus
      ? {
          key: 'status',
          label: `状态：${STATUS_OPTIONS.find((option) => option.value === appliedStatus)?.label ?? appliedStatus}`,
          onClear: clearStatus,
        }
      : null,
    appliedCapability
      ? {
          key: 'capability',
          label: `能力：${appliedCapability}`,
          onClear: clearCapability,
        }
      : null,
    appliedOwner
      ? {
          key: 'userId',
          label: `用户 ID：${appliedOwner}`,
          onClear: clearOwner,
        }
      : null,
    appliedProject
      ? {
          key: 'projectId',
          label: `项目 ID：${appliedProject}`,
          onClear: clearProject,
        }
      : null,
    appliedErrorCode
      ? {
          key: 'errorCode',
          label: `错误码：${appliedErrorCode}`,
          onClear: clearErrorCode,
        }
      : null,
    appliedFrom
      ? {
          key: 'from',
          label: `开始：${appliedFrom}`,
          onClear: clearFrom,
        }
      : null,
    appliedTo
      ? {
          key: 'to',
          label: `结束：${appliedTo}`,
          onClear: clearTo,
        }
      : null,
  ];
  const appliedChips = appliedChipCandidates.filter(
    (item): item is AppliedFilter => item !== null,
  );

  const exportTasks = useCallback(async () => {
    if (exportingRef.current) return;
    exportingRef.current = true;
    setExporting(true);
    try {
      // 导出与屏幕上的列表同口径，使用已生效参数而不是输入框草稿。
      await adminTasksApi.exportCsv({
        status: appliedStatus,
        capability: appliedCapability,
        userId: appliedOwner || undefined,
        projectId: appliedProject || undefined,
        errorCode: appliedErrorCode || undefined,
        from: appliedFrom || undefined,
        to: appliedTo || undefined,
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '导出失败');
    } finally {
      exportingRef.current = false;
      setExporting(false);
    }
  }, [
    appliedCapability,
    appliedErrorCode,
    appliedFrom,
    appliedOwner,
    appliedProject,
    appliedStatus,
    appliedTo,
    toast,
  ]);

  const appliedFilters = {
    status: appliedStatus,
    capability: appliedCapability,
    userId: appliedOwner || undefined,
    projectId: appliedProject || undefined,
    errorCode: appliedErrorCode || undefined,
    from: appliedFrom || undefined,
    to: appliedTo || undefined,
  };
  const draftFilters = {
    status,
    capability,
    userId: owner.trim() || undefined,
    projectId: project.trim() || undefined,
    errorCode: errorCode.trim() || undefined,
    from: from || undefined,
    to: to || undefined,
  };

  return {
    status,
    setStatus,
    capability,
    setCapability,
    owner,
    setOwner,
    project,
    setProject,
    errorCode,
    setErrorCode,
    from,
    setFrom,
    to,
    setTo,
    capOptions,
    appliedFilters,
    draftFilters,
    appliedChips,
    hasFilter,
    data,
    loading,
    error,
    params,
    sort,
    exporting,
    setQuery,
    setPage,
    reload,
    applyFilters,
    applyView,
    resetFilters,
    exportTasks,
  };
}
