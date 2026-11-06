import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAdminExport, type AppliedFilter } from '~/admin-ui/primitives';
import { adminOrdersApi } from './api';
import { CHANNEL_LABELS, REFUND_STATE_OPTIONS, STATUS_OPTIONS } from './constants';
import { useAdminList, useAdminUrlFilterSync, useToast } from './hooks';
import type { OrderFilterKey, OrderFilterValues } from './OrderFilterBar';
import type { AdminOrderListResult } from '../../../types/api';

const REFUND_STATE_VALUES = new Set(REFUND_STATE_OPTIONS.map((option) => option.value));
const STATUS_VALUES = new Set(STATUS_OPTIONS.map((option) => option.value));

type OrderListParams = Record<string, unknown> & {
  page: number;
  pageSize: number;
  status?: string;
  refundState?: string;
  orderNo?: string;
  email?: string;
  channel?: string;
  from?: string;
  to?: string;
};

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function readOption(params: URLSearchParams, key: string, values: Set<string>): string | undefined {
  const value = params.get(key);
  return value && values.has(value) ? value : undefined;
}

interface UseOrderFiltersOptions {
  /** 已生效查询变化时通知页面清理跨页选择。 */
  onQueryChange?: () => void;
}

/**
 * 订单列表的筛选、URL 同步与导出。
 *
 * 输入草稿和已生效查询分开：输入框只在「查询」或回车时提交。URL 只同步
 * 已生效条件，深链刷新、告警中心跳转和浏览器前进后退都能恢复相同口径。
 */
export function useOrderFilters({ onQueryChange }: UseOrderFiltersOptions = {}) {
  const toast = useToast();
  const [searchParams] = useSearchParams();

  const initialStatus = readOption(searchParams, 'status', STATUS_VALUES);
  const initialRefundState = readOption(searchParams, 'refundState', REFUND_STATE_VALUES);
  const initialOrderNo = searchParams.get('orderNo') ?? '';
  const initialEmail = searchParams.get('email') ?? '';
  const initialChannel = searchParams.get('channel') ?? undefined;
  const initialFrom = searchParams.get('from') ?? '';
  const initialTo = searchParams.get('to') ?? '';

  const [status, setStatus] = useState<string | undefined>(initialStatus);
  const [refundState, setRefundState] = useState<string | undefined>(initialRefundState);
  const [orderNo, setOrderNo] = useState(initialOrderNo);
  const [email, setEmail] = useState(initialEmail);
  const [channel, setChannel] = useState<string | undefined>(initialChannel);
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);
  const appliedUrlRefundState = useRef<string | undefined>(initialRefundState);
  const appliedOrderNoRef = useRef(initialOrderNo);
  const onQueryChangeRef = useRef(onQueryChange);
  onQueryChangeRef.current = onQueryChange;

  const notifyQueryChange = useCallback(() => {
    onQueryChangeRef.current?.();
  }, []);

  const fetcher = useCallback((raw: OrderListParams) => {
    return adminOrdersApi.list({
      page: raw.page,
      pageSize: raw.pageSize,
      status: raw.status,
      orderNo: raw.orderNo,
      email: raw.email,
      channel: raw.channel,
      refundState: raw.refundState,
      from: raw.from,
      to: raw.to,
    });
  }, []);

  const { data, loading, error, params, setQuery, setPage, reload } = useAdminList<
    AdminOrderListResult,
    OrderListParams
  >(fetcher, {
    ...(initialStatus ? { status: initialStatus } : {}),
    ...(initialRefundState ? { refundState: initialRefundState } : {}),
    ...(initialOrderNo ? { orderNo: initialOrderNo } : {}),
    ...(initialEmail ? { email: initialEmail } : {}),
    ...(initialChannel ? { channel: initialChannel } : {}),
    ...(initialFrom ? { from: initialFrom } : {}),
    ...(initialTo ? { to: initialTo } : {}),
  });

  /** 顶栏搜索带 `?orderNo=` 跳过来时自动套用（ref 防止覆盖页内手动筛选） */
  const urlOrderNo = searchParams.get('orderNo') ?? '';
  useEffect(() => {
    if (!urlOrderNo || urlOrderNo === appliedOrderNoRef.current) return;
    appliedOrderNoRef.current = urlOrderNo;
    setOrderNo(urlOrderNo);
    notifyQueryChange();
    setQuery({ orderNo: urlOrderNo });
  }, [urlOrderNo, setQuery, notifyQueryChange]);

  /* 告警中心链接 `?refundState=processing`：已在本页时也要把筛选同步过去 */
  useEffect(() => {
    const next = readOption(searchParams, 'refundState', REFUND_STATE_VALUES);
    if (next === appliedUrlRefundState.current) return;
    appliedUrlRefundState.current = next;
    setRefundState(next);
    notifyQueryChange();
    // 浏览器后退到无 refundState 的地址时也要清掉筛选，保持列表与地址栏一致
    setQuery({ refundState: next });
  }, [searchParams, setQuery, notifyQueryChange]);

  useAdminUrlFilterSync({
    status: params.status,
    refundState: params.refundState,
    orderNo: params.orderNo,
    email: params.email,
    channel: params.channel,
    from: params.from,
    to: params.to,
  });

  const appliedStatus = params.status;
  const appliedRefundState = params.refundState;
  const appliedOrderNo = params.orderNo ?? '';
  const appliedEmail = params.email ?? '';
  const appliedChannel = params.channel;
  const appliedFrom = params.from ?? '';
  const appliedTo = params.to ?? '';

  /** 空态与「清除筛选」按已生效的查询判断，输入框草稿不算 */
  const hasFilter = Boolean(
    appliedStatus || appliedRefundState || appliedOrderNo || appliedEmail || appliedChannel || appliedFrom || appliedTo,
  );

  const updateFilter = (key: OrderFilterKey, value: string | undefined) => {
    switch (key) {
      case 'status':
        setStatus(value);
        break;
      case 'refundState':
        setRefundState(value);
        break;
      case 'orderNo':
        setOrderNo(value ?? '');
        break;
      case 'email':
        setEmail(value ?? '');
        break;
      case 'channel':
        setChannel(value);
        break;
      case 'from':
        setFrom(value ?? '');
        break;
      case 'to':
        setTo(value ?? '');
        break;
    }
  };

  const applyQuery = () => {
    const nextOrderNo = orderNo.trim();
    appliedOrderNoRef.current = nextOrderNo;
    appliedUrlRefundState.current = refundState;
    notifyQueryChange();
    setQuery({
      status,
      refundState,
      orderNo: nextOrderNo || undefined,
      email: email.trim() || undefined,
      channel,
      from: from || undefined,
      to: to || undefined,
    });
  };

  const reset = () => {
    appliedOrderNoRef.current = '';
    appliedUrlRefundState.current = undefined;
    setStatus(undefined);
    setRefundState(undefined);
    setOrderNo('');
    setEmail('');
    setChannel(undefined);
    setFrom('');
    setTo('');
    notifyQueryChange();
    setQuery({
      status: undefined,
      refundState: undefined,
      orderNo: undefined,
      email: undefined,
      channel: undefined,
      from: undefined,
      to: undefined,
    });
  };

  const clearOrderNo = () => {
    appliedOrderNoRef.current = '';
    setOrderNo('');
    notifyQueryChange();
    setQuery({ orderNo: undefined });
  };

  const clearEmail = () => {
    setEmail('');
    notifyQueryChange();
    setQuery({ email: undefined });
  };

  const clearStatus = () => {
    setStatus(undefined);
    notifyQueryChange();
    setQuery({ status: undefined });
  };

  const clearRefundState = () => {
    appliedUrlRefundState.current = undefined;
    setRefundState(undefined);
    notifyQueryChange();
    setQuery({ refundState: undefined });
  };

  const clearChannel = () => {
    setChannel(undefined);
    notifyQueryChange();
    setQuery({ channel: undefined });
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
    appliedOrderNo
      ? {
          key: 'orderNo',
          label: `订单号「${appliedOrderNo}」`,
          onClear: clearOrderNo,
        }
      : null,
    appliedEmail
      ? {
          key: 'email',
          label: `邮箱「${appliedEmail}」`,
          onClear: clearEmail,
        }
      : null,
    appliedStatus
      ? {
          key: 'status',
          label: `状态：${STATUS_OPTIONS.find((option) => option.value === appliedStatus)?.label ?? appliedStatus}`,
          onClear: clearStatus,
        }
      : null,
    appliedRefundState
      ? {
          key: 'refundState',
          label: `退款：${REFUND_STATE_OPTIONS.find((option) => option.value === appliedRefundState)?.label ?? appliedRefundState}`,
          onClear: clearRefundState,
        }
      : null,
    appliedChannel
      ? {
          key: 'channel',
          label: `渠道：${CHANNEL_LABELS[appliedChannel] ?? appliedChannel}`,
          onClear: clearChannel,
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
  const appliedChips = appliedChipCandidates.filter((item): item is AppliedFilter => item !== null);

  const { exporting, runExport } = useAdminExport(toast);

  /** 导出走当前筛选条件 —— 导出的口径必须与屏幕上看到的一致, 否则运营会对不上账 */
  const exportCsv = () =>
    runExport(
      () =>
        adminOrdersApi.exportCsv({
          status: appliedStatus,
          refundState: appliedRefundState,
          orderNo: appliedOrderNo || undefined,
          email: appliedEmail || undefined,
          channel: appliedChannel,
          from: appliedFrom || undefined,
          to: appliedTo || undefined,
        }),
      '导出已开始下载',
    );

  const values: OrderFilterValues = {
    status,
    refundState,
    orderNo,
    email,
    channel,
    from,
    to,
  };

  return {
    values,
    updateFilter,
    applyQuery,
    reset,
    appliedChips,
    hasFilter,
    data,
    loading,
    error,
    setPage,
    reload,
    exporting,
    exportCsv,
  };
}
