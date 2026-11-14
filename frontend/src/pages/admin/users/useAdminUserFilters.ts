import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { type AppliedFilter } from '~/admin-ui/primitives';
import { adminUsersApi } from './api';
import {
  DEFAULT_SORT,
  MEMBERSHIP_OPTIONS,
  ROLE_OPTIONS,
  SEGMENT_OPTIONS,
  STATUS_OPTIONS,
} from './constants';
import { useAdminList, useAdminUrlFilterSync, useToast } from './hooks';
import type { AdminUserListResult } from '../../../types/api';
import type {
  AdminUserListQuery,
  AdminUserMembershipFilter,
  AdminUserRole,
  AdminUserSegment,
  AdminUserStatus,
} from './types';

const ROLE_VALUES = new Set<string>(ROLE_OPTIONS.map(({ value }) => value));
const STATUS_VALUES = new Set<string>(STATUS_OPTIONS.map(({ value }) => value));
const SEGMENT_VALUES = new Set<string>(SEGMENT_OPTIONS.map(({ value }) => value));
const MEMBERSHIP_VALUES = new Set<string>(
  MEMBERSHIP_OPTIONS.map(({ value }) => value),
);

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

function segmentValue(value: unknown): AdminUserSegment | undefined {
  return typeof value === 'string' && SEGMENT_VALUES.has(value)
    ? (value as AdminUserSegment)
    : undefined;
}

function membershipValue(
  value: unknown,
): AdminUserMembershipFilter | undefined {
  return typeof value === 'string' && MEMBERSHIP_VALUES.has(value)
    ? (value as AdminUserMembershipFilter)
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

/** 日期选择器给的是 `yyyy-MM-dd`（浏览器本地时区）；发送前补成当天起止时刻。 */
function dayStart(value: string): string | undefined {
  if (!value) return undefined;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function dayEnd(value: string): string | undefined {
  if (!value) return undefined;
  const date = new Date(`${value}T23:59:59.999`);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

/**
 * 用户列表筛选、URL 同步、全局统计与导出。
 *
 * 输入草稿和已生效查询分开：输入框只在「查询」或回车时提交，避免每键请求。
 * URL 只同步筛选与排序，不同步页码 —— 分享链接不应该把对方带到第 7 页。
 */
export function useAdminUserFilters() {
  const toast = useToast();
  const [searchParams] = useSearchParams();

  const initialKeyword = searchParams.get('q') ?? '';
  const initialRole = readOption<AdminUserRole>(searchParams, 'role', ROLE_VALUES);
  const initialStatus = readOption<AdminUserStatus>(
    searchParams,
    'status',
    STATUS_VALUES,
  );
  const initialFrom = searchParams.get('from') ?? '';
  const initialTo = searchParams.get('to') ?? '';
  const initialSegment = readOption<AdminUserSegment>(
    searchParams,
    'segment',
    SEGMENT_VALUES,
  );
  const initialMembership = readOption<AdminUserMembershipFilter>(
    searchParams,
    'membership',
    MEMBERSHIP_VALUES,
  );
  const initialSort = searchParams.get('sort') ?? DEFAULT_SORT;

  const [keyword, setKeyword] = useState(initialKeyword);
  const [role, setRole] = useState<AdminUserRole | undefined>(initialRole);
  const [status, setStatus] = useState<AdminUserStatus | undefined>(initialStatus);
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);
  const [segment, setSegment] = useState<AdminUserSegment | undefined>(
    initialSegment,
  );
  const [membership, setMembership] = useState<
    AdminUserMembershipFilter | undefined
  >(initialMembership);
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
      from: dayStart(stringValue(raw.from) ?? ''),
      to: dayEnd(stringValue(raw.to) ?? ''),
      segment: segmentValue(raw.segment),
      membership: membershipValue(raw.membership),
      sort: stringValue(raw.sort) ?? DEFAULT_SORT,
    };
    return adminUsersApi.list(query);
  }, []);

  const { data, loading, error, params, setQuery, setPage, reload } =
    useAdminList<AdminUserListResult>(fetcher, {
      ...(initialKeyword ? { keyword: initialKeyword } : {}),
      ...(initialRole ? { role: initialRole } : {}),
      ...(initialStatus ? { status: initialStatus } : {}),
      ...(initialFrom ? { from: initialFrom } : {}),
      ...(initialTo ? { to: initialTo } : {}),
      ...(initialSegment ? { segment: initialSegment } : {}),
      ...(initialMembership ? { membership: initialMembership } : {}),
      ...(initialSort !== DEFAULT_SORT ? { sort: initialSort } : {}),
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

  const appliedKeyword = stringValue(params.keyword) ?? '';
  const appliedRole = roleValue(params.role);
  const appliedStatus = statusValue(params.status);
  const appliedFrom = stringValue(params.from) ?? '';
  const appliedTo = stringValue(params.to) ?? '';
  const appliedSegment = segmentValue(params.segment);
  const appliedMembership = membershipValue(params.membership);
  const sort = stringValue(params.sort) ?? DEFAULT_SORT;
  const rows = data?.items ?? [];
  const hasFilter = Boolean(
    appliedKeyword ||
      appliedRole ||
      appliedStatus ||
      appliedFrom ||
      appliedTo ||
      appliedSegment ||
      appliedMembership,
  );

  useAdminUrlFilterSync({
    q: appliedKeyword || undefined,
    role: appliedRole,
    status: appliedStatus,
    from: appliedFrom || undefined,
    to: appliedTo || undefined,
    segment: appliedSegment,
    membership: appliedMembership,
    sort: sort === DEFAULT_SORT ? undefined : sort,
  });

  const applyFilters = () => {
    const nextKeyword = keyword.trim();
    appliedQ.current = nextKeyword;
    setQuery({
      keyword: nextKeyword || undefined,
      role,
      status,
      from: from || undefined,
      to: to || undefined,
      segment,
      membership,
    });
  };

  const resetFilters = () => {
    appliedQ.current = '';
    setKeyword('');
    setRole(undefined);
    setStatus(undefined);
    setFrom('');
    setTo('');
    setSegment(undefined);
    setMembership(undefined);
    setQuery({
      keyword: undefined,
      role: undefined,
      status: undefined,
      from: undefined,
      to: undefined,
      segment: undefined,
      membership: undefined,
      sort: DEFAULT_SORT,
    });
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

  const clearDateRange = () => {
    setFrom('');
    setTo('');
    setQuery({ from: undefined, to: undefined });
  };

  const clearSegment = () => {
    setSegment(undefined);
    setQuery({ segment: undefined });
  };

  const clearMembership = () => {
    setMembership(undefined);
    setQuery({ membership: undefined });
  };

  const appliedChipCandidates: Array<AppliedFilter | null> = [
    appliedKeyword
      ? {
        key: 'keyword',
        label: `关键词「${appliedKeyword}」`,
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
    appliedFrom || appliedTo
      ? {
        key: 'date',
        label: `注册：${appliedFrom || '不限'} ~ ${appliedTo || '不限'}`,
        onClear: clearDateRange,
      }
      : null,
    appliedSegment
      ? {
        key: 'segment',
        label: `分群：${SEGMENT_OPTIONS.find((option) => option.value === appliedSegment)?.label ?? appliedSegment}`,
        onClear: clearSegment,
      }
      : null,
    appliedMembership
      ? {
        key: 'membership',
        label: `会员：${MEMBERSHIP_OPTIONS.find((option) => option.value === appliedMembership)?.label ?? appliedMembership}`,
        onClear: clearMembership,
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
      const result = await adminUsersApi.exportCsv({
        keyword: appliedKeyword || undefined,
        role: appliedRole,
        status: appliedStatus,
        from: dayStart(appliedFrom),
        to: dayEnd(appliedTo),
        segment: appliedSegment,
        membership: appliedMembership,
        sort,
      });
      if (result.truncated) {
        toast.error(
          `导出已截断：共 ${result.total} 条，文件只包含前 ${result.limit} 条`,
        );
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '导出失败');
    } finally {
      exportingRef.current = false;
      setExporting(false);
    }
  }, [
    appliedKeyword,
    appliedRole,
    appliedStatus,
    appliedFrom,
    appliedTo,
    appliedSegment,
    appliedMembership,
    sort,
    toast,
  ]);

  return {
    keyword,
    setKeyword,
    role,
    setRole,
    status,
    setStatus,
    from,
    setFrom,
    to,
    setTo,
    segment,
    setSegment,
    membership,
    setMembership,
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
    setPage: (page: number, pageSize?: number) => {
      setPage(page, pageSize);
    },
    reload,
    applyFilters,
    resetFilters,
    exportUsers,
  };
}
