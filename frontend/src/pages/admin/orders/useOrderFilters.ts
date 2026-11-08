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
  productId?: string;
  /**
   * 商品名只用于筛选条上的可读标签，不发给后端（后端按 id 查）。
   * 留在 params 里是为了跟着 `useAdminUrlFilterSync` 一起写回地址栏，
   * 刷新后标签还在；fetcher 显式挑字段，所以它不会被发出去。
   */
  productName?: string;
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
  /*
   * 商品维度筛选来自商品卡的「N 单」深链（`?productId=`）。
   * `productName` 只是筛选条上的可读标签 —— 订单列表按 id 查，不按名字查；
   * 名字缺失时退回显示 id，不影响筛选本身生效。
   */
  const initialProductId = searchParams.get('productId') ?? '';
  const initialProductName = searchParams.get('productName') ?? '';

  const [status, setStatus] = useState<string | undefined>(initialStatus);
  const [refundState, setRefundState] = useState<string | undefined>(initialRefundState);
  const [orderNo, setOrderNo] = useState(initialOrderNo);
  const [email, setEmail] = useState(initialEmail);
  const [channel, setChannel] = useState<string | undefined>(initialChannel);
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);
  const [productId, setProductId] = useState(initialProductId);
  const [productName, setProductName] = useState(initialProductName);
  const appliedUrlRefundState = useRef<string | undefined>(initialRefundState);
  const appliedOrderNoRef = useRef(initialOrderNo);
  const appliedProductIdRef = useRef(initialProductId);
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
      productId: raw.productId,
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
    ...(initialProductId ? { productId: initialProductId } : {}),
    ...(initialProductId && initialProductName ? { productName: initialProductName } : {}),
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

  /**
   * 商品卡「N 单」跳过来时套用（`?productId=`）。
   *
   * 与 orderNo 同样的处理：已在本页时也要响应，后退到无该参数的地址时清掉。
   * 名字一起跟上，否则筛选条只能显示一串 id。
   */
  const urlProductId = searchParams.get('productId') ?? '';
  useEffect(() => {
    if (urlProductId === appliedProductIdRef.current) return;
    appliedProductIdRef.current = urlProductId;
    const nextName = urlProductId ? (searchParams.get('productName') ?? '') : '';
    setProductId(urlProductId);
    setProductName(nextName);
    notifyQueryChange();
    setQuery({ productId: urlProductId || undefined, productName: nextName || undefined });
  }, [urlProductId, searchParams, setQuery, notifyQueryChange]);

  useAdminUrlFilterSync({
    status: params.status,
    refundState: params.refundState,
    orderNo: params.orderNo,
    email: params.email,
    channel: params.channel,
    productId: params.productId,
    productName: params.productName,
    from: params.from,
    to: params.to,
  });

  const appliedStatus = params.status;
  const appliedRefundState = params.refundState;
  const appliedOrderNo = params.orderNo ?? '';
  const appliedEmail = params.email ?? '';
  const appliedChannel = params.channel;
  const appliedProductId = params.productId ?? '';
  const appliedProductName = params.productName ?? '';
  const appliedFrom = params.from ?? '';
  const appliedTo = params.to ?? '';

  /** 空态与「清除筛选」按已生效的查询判断，输入框草稿不算 */
  const hasFilter = Boolean(
    appliedStatus ||
      appliedRefundState ||
      appliedOrderNo ||
      appliedEmail ||
      appliedChannel ||
      appliedProductId ||
      appliedFrom ||
      appliedTo,
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
      // 商品筛选不在筛选条里编辑，点「查询」时保持原样，不能把它冲掉
      productId: productId || undefined,
      productName: productName || undefined,
      from: from || undefined,
      to: to || undefined,
    });
  };

  const reset = () => {
    appliedOrderNoRef.current = '';
    appliedUrlRefundState.current = undefined;
    appliedProductIdRef.current = '';
    setStatus(undefined);
    setRefundState(undefined);
    setOrderNo('');
    setEmail('');
    setChannel(undefined);
    setProductId('');
    setProductName('');
    setFrom('');
    setTo('');
    notifyQueryChange();
    setQuery({
      status: undefined,
      refundState: undefined,
      orderNo: undefined,
      email: undefined,
      channel: undefined,
      productId: undefined,
      productName: undefined,
      from: undefined,
      to: undefined,
    });
  };

  /** 清商品筛选。同时清掉只读标签，否则筛选条会留一个点不掉的壳 */
  const clearProduct = () => {
    appliedProductIdRef.current = '';
    setProductId('');
    setProductName('');
    notifyQueryChange();
    setQuery({ productId: undefined, productName: undefined });
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

  /* 起止日期同属「时间」一个条件：合成一枚 chip，避免撤掉一半留下半个时间窗 */
  const appliedDateLabel = appliedFrom
    ? appliedTo
      ? `时间：${appliedFrom} ~ ${appliedTo}`
      : `时间：${appliedFrom} 起`
    : appliedTo
      ? `时间：截至 ${appliedTo}`
      : null;

  const clearDateRange = () => {
    setFrom('');
    setTo('');
    notifyQueryChange();
    setQuery({ from: undefined, to: undefined });
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
    appliedProductId
      ? {
          key: 'productId',
          label: `商品：${appliedProductName || appliedProductId}`,
          onClear: clearProduct,
        }
      : null,
    appliedDateLabel
      ? {
          key: 'date',
          label: appliedDateLabel,
          onClear: clearDateRange,
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
          productId: appliedProductId || undefined,
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
