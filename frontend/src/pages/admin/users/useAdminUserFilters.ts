import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { type AppliedFilter } from '~/admin-ui/primitives';
import { adminUsersApi } from './api';
import {
  DEFAULT_SORT,
  ROLE_OPTIONS,
  STATUS_OPTIONS,
} from './constants';
import { useAdminList, useAdminUrlFilterSync, useToast } from './hooks';
import type { AdminUserListResult } from '../../../types/api';
import type {
  AdminUserListQuery,
  AdminUserRole,
  AdminUserStatus,
} from './types';

const ROLE_VALUES = new Set<string>(ROLE_OPTIONS.map(({ value }) => value));
const STATUS_VALUES = new Set<string>(STATUS_OPTIONS.map(({ value }) => value));

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function numberValue(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function roleValue(value: unknown): AdminUserRole | undefined {
  return typeof value === 'string' && ROLE_VALUES.has(value)
    ? (value as AdminUserRole)
    : undefined;
}

function statusValue(value: unknown): AdminUserStatus | undefined {
  return typeof value === 'string' && STATUS_VALUES.has(value)
    ? (value as AdminUserStatus)
    : undefined;
}

function readOption<T extends string>(
  params: URLSearchParams,
  key: string,
  values: Set<string>,
): T | undefined {
  const value = params.get(key);
  return value && values.has(value) ? (value as T) : undefined;
}

/**
 * 用户列表筛选、URL 同步与导出。
 *
 * 输入草稿和已生效查询分开：输入框只在「查询」或回车时提交，避免每键请求。
 * URL 只同步已生效条件，深链刷新与浏览器前后退都能恢复相同口径。
 */
export function useAdminUserFilters() {
  const toast = useToast();
  const [searchParams] = useSearchParams();

  const initialKeyword = searchParams.get('q') ?? '';
  const initialRole = readOption<AdminUserRole>(searchParams, 'role', ROLE_VALUES);
  const initialStatus = readOption<AdminUserStatus>(searchParams, 'status', STATUS_VALUES);

  const [keyword, setKeyword] = useState(initialKeyword);
  const [role, setRole] = useState<AdminUserRole | undefined>(initialRole);
  const [status, setStatus] = useState<AdminUserStatus | undefined>(initialStatus);
  const [exporting, setExporting] = useState(false);
  const exportingRef = useRef(false);
  const appliedQ = useRef(initialKeyword);

  const fetcher = useCallback((raw: Record<string, unknown>) => {
    const query: AdminUserListQuery = {
      page: numberValue(raw.page, 1),
      pageSize: numberValue(raw.pageSize, 20),
      keyword: stringValue(raw.keyword),
      role: roleValue(raw.role),
      status: statusValue(raw.status),
      sort: stringValue(raw.sort) ?? DEFAULT_SORT,
    };
    return adminUsersApi.list(query);
  }, []);

  const { data, loading, error, params, setQuery, setPage, reload } =
    useAdminList<AdminUserListResult>(fetcher, {
      ...(initialKeyword ? { keyword: initialKeyword } : {}),
      ...(initialRole ? { role: initialRole } : {}),
      ...(initialStatus ? { status: initialStatus } : {}),
    });

  /*
   * 顶栏全局搜索带 `?q=` 跳过来时自动套用筛选。
   * 用 ref 记录已经应用过的值，避免覆盖用户在页内手动修改的筛选草稿。
   */
  const urlQ = searchParams.get('q') ?? '';
  useEffect(() => {
    if (urlQ === appliedQ.current) return;
    appliedQ.current = urlQ;
    setKeyword(urlQ);
    setQuery({ keyword: urlQ || undefined });
  }, [urlQ, setQuery]);

  useAdminUrlFilterSync({
    q: stringValue(params.keyword),
    role: stringValue(params.role),
    status: stringValue(params.status),
  });

  const appliedKeyword = stringValue(params.keyword) ?? '';
  const appliedRole = roleValue(params.role);
  const appliedStatus = statusValue(params.status);
  const sort = stringValue(params.sort) ?? DEFAULT_SORT;
  const rows = data?.items ?? [];
  const hasFilter = Boolean(appliedKeyword || appliedRole || appliedStatus);

  const applyFilters = () => {
    const nextKeyword = keyword.trim();
    appliedQ.current = nextKeyword;
    setQuery({
      keyword: nextKeyword || undefined,
      role,
      status,
    });
  };

  const resetFilters = () => {
    appliedQ.current = '';
    setKeyword('');
    setRole(undefined);
    setStatus(undefined);
    setQuery({ keyword: undefined, role: undefined, status: undefined });
  };

  const clearKeyword = () => {
    appliedQ.current = '';
    setKeyword('');
    setQuery({ keyword: undefined });
  };

  const clearRole = () => {
    setRole(undefined);
    setQuery({ role: undefined });
  };

  const clearStatus = () => {
    setStatus(undefined);
    setQuery({ status: undefined });
  };

  const appliedChipCandidates: Array<AppliedFilter | null> = [
    appliedKeyword
      ? {
        key: 'keyword',
        label: `邮箱「${appliedKeyword}」`,
        onClear: clearKeyword,
      }
      : null,
    appliedRole
      ? {
        key: 'role',
        label: `角色：${ROLE_OPTIONS.find((option) => option.value === appliedRole)?.label ?? appliedRole}`,
        onClear: clearRole,
      }
      : null,
    appliedStatus
      ? {
        key: 'status',
        label: `状态：${STATUS_OPTIONS.find((option) => option.value === appliedStatus)?.label ?? appliedStatus}`,
        onClear: clearStatus,
      }
      : null,
  ];
  const appliedChips = appliedChipCandidates.filter(
    (item): item is AppliedFilter => item !== null,
  );

  const exportUsers = useCallback(async () => {
    if (exportingRef.current) return;
    exportingRef.current = true;
    setExporting(true);
    try {
      // 导出必须与屏幕上的列表同口径：使用已生效参数，而不是输入框草稿。
      await adminUsersApi.exportCsv({
        keyword: appliedKeyword || undefined,
        role: appliedRole,
        status: appliedStatus,
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '导出失败');
    } finally {
      exportingRef.current = false;
      setExporting(false);
    }
  }, [appliedKeyword, appliedRole, appliedStatus, toast]);

  return {
    keyword,
    setKeyword,
    role,
    setRole,
    status,
    setStatus,
    data,
    loading,
    error,
    rows,
    params,
    sort,
    appliedChips,
    hasFilter,
    exporting,
    setQuery,
    setPage,
    reload,
    applyFilters,
    resetFilters,
    exportUsers,
  };
}
