import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Download } from 'lucide-react';
import { Button } from '../../vendor/boardui/components/base/buttons/button';
import { adminOrdersApi } from '../../lib/api';
import { useAdmin } from '../../context/AdminContext';
import { useToast } from '../../admin-ui/providers/ToastProvider';
import { AdminDataTable, type AdminColumn } from '../../admin-ui/primitives/DataTable';
import { Descriptions } from '../../admin-ui/primitives';
import { SelectBox, TextInput } from '../../admin-ui/controls';
import { cx } from '../../admin-ui/lib/cn';
import {
  AdminDrawer,
  AdminStaleError,
  ConfirmAction,
  useAdminDetailParam,
  useAdminList,
  useAdminUrlFilterSync,
} from '../../components/admin/AdminWidgets';
import {
  AppliedFilters,
  FilterActions,
  FilterBar,
  PageHeader,
  Panel,
  StatusTag,
  type AppliedFilter,
} from '../../components/admin/PageHeader';
import { BatchResultModal } from '../../components/admin/BatchResultModal';
import {
  adminCreditHref,
  adminOrderDetailHref,
  adminTasksHref,
  adminUserDetailHref,
} from '../../lib/admin-links';
import type {
  AdminOrderDetail,
  AdminOrderListResult,
  AdminOrderRow,
  BatchSummary,
} from '../../types/api';

/**
 * 订单管理 (B-39~B-44)。
 *
 * ## 客服视角的参数设计
 *
 * 最高频的问法是「我是 xxx@yy.com，上周买的，怎么没到账」。所以筛选必须支持
 * 邮箱 + 日期范围, 而且日期只填到「日」就该包含整天 —— 让客服为查一个订单
 * 去算 23:59:59 是错误的复杂度。
 *
 * ## 核销与退款都是「钱的动作」
 *
 * 核销造一条 channel=manual 的支付流水 (交易号带管理员 id), 退款写 Refund 记录
 * 并回收积分。两者都进操作审计, 原因必填 —— 事后必须能回答「谁在什么时候、
 * 凭什么把这一单标成已付/退掉」。
 */

/** 分 → 元文本 */
function yuan(cents: number): string {
  return (cents / 100).toFixed(2);
}

/** 元输入 → 分。非法返回 null, 不做静默兜底 */
function yuanToCents(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  const cents = Math.round(Number(trimmed) * 100);
  return cents > 0 ? cents : null;
}

const STATUS_OPTIONS = [
  { value: 'pending', label: '待支付' },
  { value: 'paid', label: '已支付' },
  { value: 'cancelled', label: '已取消' },
  { value: 'refunded', label: '已退款' },
  { value: 'partial_refunded', label: '部分退款' },
];

/**
 * 订单状态标签的文案覆盖。
 *
 * 与任务状态共用 `pending` 这个值: 任务的 pending 是「等待执行」,
 * 订单的 pending 是「待支付」—— 共用键没法在映射表里同时正确。
 */
const STATUS_LABEL_OVERRIDE: Record<string, string> = { pending: '待支付' };

/**
 * 退款状态 → 中文 (2026-10-22)。
 *
 * 退款不再是「按下即完成」: 渠道可能异步处理 (`processing`) 或拒绝 (`failed`)。
 * 未知值原样显示 —— 后端新增状态时不该被这个映射静默吞掉。
 */
const REFUND_STATUS_LABELS: Record<string, string> = {
  succeeded: '退款成功',
  processing: '渠道处理中',
  failed: '退款失败',
};

/** 退款状态筛选项。值必须与后端 `REFUND_STATES` 白名单一致 */
const REFUND_STATE_OPTIONS = [
  { value: 'processing', label: '渠道处理中' },
  { value: 'failed', label: '退款失败' },
  { value: 'succeeded', label: '退款成功' },
];

/** 渠道 → 中文。未知渠道原样显示, 便于发现未登记的取值 */
const CHANNEL_LABELS: Record<string, string> = {
  sandbox: '沙箱',
  manual: '手工核销',
  alipay: '支付宝',
  wechat: '微信支付',
};

/** 详情抽屉里的小节标题：标题 + 一句口径说明 */
function SectionTitle({ title, note }: { title: string; note?: string }) {
  return (
    <div className="mb-2 flex items-baseline gap-2 border-b border-border-table pb-1.5">
      <strong className="text-xs font-semibold text-text-primary">{title}</strong>
      {note && <span className="text-[11px] text-text-tertiary">{note}</span>}
    </div>
  );
}

/** 详情抽屉里的一条时间线记录：状态点 + 主行 + 灰色补充行 */
function RecordRow({
  head,
  meta,
  state = 'done',
}: {
  head: ReactNode;
  meta: ReactNode;
  /** 未成功的流水/退款用灰点：既保留时间线，又不假装它已经成立 */
  state?: 'done' | 'pending';
}) {
  return (
    <li className="flex items-start gap-2.5 px-3 py-2">
      <span
        className={cx(
          'mt-1.5 size-1.5 shrink-0 rounded-full',
          state === 'done' ? 'bg-accent-500' : 'bg-neutral-300',
        )}
        aria-hidden
      />
      <span className="min-w-0 flex-1">
        <span className="block text-xs text-text-primary">{head}</span>
        <span className="mt-0.5 block text-[11px] leading-4 text-text-tertiary">{meta}</span>
      </span>
    </li>
  );
}

export function AdminOrdersPage() {
  const toast = useToast();
  const { can } = useAdmin();

  /*
   * 退款状态可以直接从 URL 带进来（告警中心 `?refundState=processing`）。
   * 非法值忽略，避免手工改地址栏把整页打到 400。
   */
  const [searchParams] = useSearchParams();
  const rawUrlRefundState = searchParams.get('refundState');
  const urlRefundState =
    rawUrlRefundState && REFUND_STATE_OPTIONS.some((o) => o.value === rawUrlRefundState)
      ? rawUrlRefundState
      : undefined;
  const appliedUrlRefundState = useRef<string | undefined>(urlRefundState);

  const rawUrlStatus = searchParams.get('status') ?? undefined;
  const initialStatus =
    rawUrlStatus && STATUS_OPTIONS.some((option) => option.value === rawUrlStatus)
      ? rawUrlStatus
      : undefined;
  const initialOrderNo = searchParams.get('orderNo') ?? '';
  const initialEmail = searchParams.get('email') ?? '';
  const initialChannel = searchParams.get('channel') ?? undefined;
  const initialFrom = searchParams.get('from') ?? '';
  const initialTo = searchParams.get('to') ?? '';

  const [status, setStatus] = useState<string | undefined>(initialStatus);
  const [refundState, setRefundState] = useState<string | undefined>(urlRefundState);
  const [orderNo, setOrderNo] = useState(initialOrderNo);
  const [email, setEmail] = useState(initialEmail);
  const [channel, setChannel] = useState<string | undefined>(initialChannel);
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);

  const [detailId, setDetailId] = useAdminDetailParam();
  const [action, setAction] = useState<{ kind: 'markPaid' | 'refund'; row: AdminOrderRow } | null>(
    null,
  );
  /** 退款金额（元）。打开弹窗时预填可退上限 */
  const [refundYuan, setRefundYuan] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);

  /*
   * 批量核销。只做「待支付 → 已支付」这一个方向:
   * 批量退款每单金额不同、还要逐单确认可退上限, 合在一个弹窗里必出错。
   */
  const [selected, setSelected] = useState<string[]>([]);
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchSummary, setBatchSummary] = useState<BatchSummary<{
    orderId: string;
    idempotentHit: boolean;
  }> | null>(null);

  const fetcher = useCallback(
    (params: Record<string, unknown>) =>
      adminOrdersApi.list({
        page: params.page as number,
        pageSize: params.pageSize as number,
        status: params.status as string | undefined,
        orderNo: params.orderNo as string | undefined,
        email: params.email as string | undefined,
        channel: params.channel as string | undefined,
        refundState: params.refundState as string | undefined,
        from: params.from as string | undefined,
        to: params.to as string | undefined,
      }),
    [],
  );

  const { data, loading, error, params, setQuery, setPage, reload } =
    useAdminList<AdminOrderListResult>(fetcher, {
      ...(initialStatus ? { status: initialStatus } : {}),
      ...(urlRefundState ? { refundState: urlRefundState } : {}),
      ...(initialOrderNo ? { orderNo: initialOrderNo } : {}),
      ...(initialEmail ? { email: initialEmail } : {}),
      ...(initialChannel ? { channel: initialChannel } : {}),
      ...(initialFrom ? { from: initialFrom } : {}),
      ...(initialTo ? { to: initialTo } : {}),
    });

  /** 顶栏搜索带 `?orderNo=` 跳过来时自动套用（ref 防止覆盖页内手动筛选） */
  const urlOrderNo = searchParams.get('orderNo') ?? '';
  const appliedOrderNoRef = useRef(initialOrderNo);
  useEffect(() => {
    if (!urlOrderNo || urlOrderNo === appliedOrderNoRef.current) return;
    appliedOrderNoRef.current = urlOrderNo;
    setOrderNo(urlOrderNo);
    setQuery({ orderNo: urlOrderNo });
  }, [urlOrderNo, setQuery]);

  /* 告警中心链接 `?refundState=processing`：已在本页时也要把筛选同步过去 */
  useEffect(() => {
    const raw = searchParams.get('refundState');
    const next =
      raw && REFUND_STATE_OPTIONS.some((o) => o.value === raw) ? raw : undefined;
    if (next === appliedUrlRefundState.current) return;
    appliedUrlRefundState.current = next;
    setRefundState(next);
    // 浏览器后退到无 refundState 的地址时也要清掉筛选，保持列表与地址栏一致
    setQuery({ refundState: next });
  }, [searchParams, setQuery]);

  useAdminUrlFilterSync({
    status: params.status as string | undefined,
    refundState: params.refundState as string | undefined,
    orderNo: params.orderNo as string | undefined,
    email: params.email as string | undefined,
    channel: params.channel as string | undefined,
    from: params.from as string | undefined,
    to: params.to as string | undefined,
  });

  const list = data;

  const hasFilter = Boolean(
    status || refundState || orderNo || email || channel || from || to,
  );

  const applyQuery = () => {
    const nextOrderNo = orderNo.trim();
    appliedOrderNoRef.current = nextOrderNo;
    appliedUrlRefundState.current = refundState;
    setSelected([]);
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
    setSelected([]);
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

  const appliedStatus = params.status as string | undefined;
  const appliedRefundState = params.refundState as string | undefined;
  const appliedOrderNo = (params.orderNo as string | undefined) ?? '';
  const appliedEmail = (params.email as string | undefined) ?? '';
  const appliedChannel = params.channel as string | undefined;
  const appliedFrom = (params.from as string | undefined) ?? '';
  const appliedTo = (params.to as string | undefined) ?? '';
  const appliedChips: AppliedFilter[] = [
    appliedOrderNo
      ? {
          key: 'orderNo',
          label: `订单号「${appliedOrderNo}」`,
          onClear: () => {
            appliedOrderNoRef.current = '';
            setOrderNo('');
            setQuery({ orderNo: undefined });
          },
        }
      : null,
    appliedEmail
      ? {
          key: 'email',
          label: `邮箱「${appliedEmail}」`,
          onClear: () => {
            setEmail('');
            setQuery({ email: undefined });
          },
        }
      : null,
    appliedStatus
      ? {
          key: 'status',
          label: `状态：${STATUS_OPTIONS.find((option) => option.value === appliedStatus)?.label ?? appliedStatus}`,
          onClear: () => {
            setStatus(undefined);
            setQuery({ status: undefined });
          },
        }
      : null,
    appliedRefundState
      ? {
          key: 'refundState',
          label: `退款：${REFUND_STATE_OPTIONS.find((option) => option.value === appliedRefundState)?.label ?? appliedRefundState}`,
          onClear: () => {
            appliedUrlRefundState.current = undefined;
            setRefundState(undefined);
            setQuery({ refundState: undefined });
          },
        }
      : null,
    appliedChannel
      ? {
          key: 'channel',
          label: `渠道：${CHANNEL_LABELS[appliedChannel] ?? appliedChannel}`,
          onClear: () => {
            setChannel(undefined);
            setQuery({ channel: undefined });
          },
        }
      : null,
    appliedFrom
      ? {
          key: 'from',
          label: `开始：${appliedFrom}`,
          onClear: () => {
            setFrom('');
            setQuery({ from: undefined });
          },
        }
      : null,
    appliedTo
      ? {
          key: 'to',
          label: `结束：${appliedTo}`,
          onClear: () => {
            setTo('');
            setQuery({ to: undefined });
          },
        }
      : null,
  ].filter(Boolean) as AppliedFilter[];

  const openAction = (kind: 'markPaid' | 'refund', row: AdminOrderRow) => {
    setAction({ kind, row });
    setReason('');
    // 默认退款金额 = 可退上限 (实付 - 已退)。部分退款时运营只需改小
    setRefundYuan(kind === 'refund' ? yuan(Math.max(row.paidCents - row.refundedCents, 0)) : '');
  };

  const runAction = async () => {
    if (!action) return;
    const trimmed = reason.trim();
    if (!trimmed) {
      toast.warning('请填写操作原因，它会写入操作审计');
      return;
    }
    setBusy(true);
    try {
      if (action.kind === 'markPaid') {
        const r = await adminOrdersApi.markPaid(action.row.id);
        toast.success(
          r.idempotentHit ? `订单已是已支付状态（${r.message ?? '幂等命中'}）` : '已标记为已支付并发放权益',
        );
      } else {
        const cents = yuanToCents(refundYuan);
        if (cents === null) {
          toast.error('退款金额格式不正确');
          setBusy(false);
          return;
        }
        const r = await adminOrdersApi.refund(action.row.id, cents, trimmed);
        /*
         * 渠道异步处理中 (微信可能返回 PROCESSING): 钱还没到账、积分也没回收,
         * 不能显示「已退款」。如实提示需要到渠道后台确认 —— 这是本仓库没有
         * 退款回调端点时的既有边界, 装作成功会让财务提前销账。
         */
        if (r.state === 'processing') {
          toast.warning(r.message || '渠道已受理退款但仍在处理中，请到渠道商户后台确认');
        } else if (r.creditsUnreclaimable > 0) {
          /*
           * 积分回收结果必须显式说出来: 用户已经花掉的积分扣不回来,
           * 只提示"退款成功"会让财务以为权益也已全额回收。
           */
          toast.warning(
            `已退款 ¥${yuan(cents)}；回收积分 ${r.creditsReclaimed}，另有 ${r.creditsUnreclaimable} 积分已被消耗无法回收`,
          );
        } else {
          toast.success(`已退款 ¥${yuan(cents)}，回收积分 ${r.creditsReclaimed}`);
        }
      }
      setAction(null);
      setDetailId(null);
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '操作失败');
    } finally {
      setBusy(false);
    }
  };

  /** 导出走当前筛选条件 —— 导出的口径必须与屏幕上看到的一致, 否则运营会对不上账 */
  const exportCsv = async () => {
    setExporting(true);
    try {
      await adminOrdersApi.exportCsv({
        status,
        refundState,
        orderNo: orderNo.trim() || undefined,
        email: email.trim() || undefined,
        channel,
        from: from || undefined,
        to: to || undefined,
      });
      toast.success('导出已开始下载');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '导出失败');
    } finally {
      setExporting(false);
    }
  };

  const runBatchMarkPaid = async () => {
    const trimmed = reason.trim();
    if (!trimmed) {
      toast.warning('请填写操作原因，它会写入操作审计');
      return;
    }
    if (selected.length === 0) return;
    setBusy(true);
    try {
      const summary = await adminOrdersApi.batchMarkPaid(selected, trimmed);
      setBatchSummary(summary);
      setBatchOpen(false);
      setSelected([]);
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '批量核销失败');
    } finally {
      setBusy(false);
    }
  };

  const columns: Array<AdminColumn<AdminOrderRow>> = [
    {
      key: 'orderNo',
      title: '订单号 / 下单时间',
      width: 180,
      render: (row) => (
        <div className="flex flex-col gap-0.5">
          <Link
            className="truncate rounded font-mono text-xs font-medium text-accent-700 hover:underline"
            to={adminOrderDetailHref(row.id)}
          >
            {row.orderNo}
          </Link>
          <span className="text-[11px] text-text-tertiary">
            {new Date(row.createdAt).toLocaleString('zh-CN')}
          </span>
        </div>
      ),
    },
    {
      key: 'user',
      title: '用户',
      width: 170,
      render: (row) => (
        <Link
          className="block max-w-[160px] truncate text-xs text-accent-700 hover:underline"
          to={adminUserDetailHref(row.userId)}
        >
          {row.userEmail}
        </Link>
      ),
    },
    {
      key: 'status',
      title: '状态 / 渠道',
      width: 120,
      render: (row) => (
        <div className="flex flex-col items-start gap-0.5">
          <StatusTag status={row.status} label={STATUS_LABEL_OVERRIDE[row.status]} />
          <span className="max-w-[110px] truncate text-[11px] text-text-tertiary">
            {row.channel ? CHANNEL_LABELS[row.channel] ?? row.channel : '—'}
          </span>
        </div>
      ),
    },
    {
      key: 'paid',
      title: '实付 / 优惠',
      width: 150,
      render: (row) => {
        const extra = [
          row.refundedCents > 0 ? `已退 ¥ ${yuan(row.refundedCents)}` : '',
          row.discountCents > 0 ? `优惠 -¥ ${yuan(row.discountCents)}` : '',
        ]
          .filter(Boolean)
          .join(' · ');
        return (
          <div className="flex flex-col gap-0.5">
            <span className="tabular-nums">¥ {yuan(row.paidCents)}</span>
            <span
              className={
                row.refundedCents > 0
                  ? 'max-w-[140px] truncate text-[11px] text-rose-600'
                  : 'max-w-[140px] truncate text-[11px] text-text-tertiary'
              }
              title={extra || undefined}
            >
              {extra || '无优惠'}
            </span>
          </div>
        );
      },
    },
    {
      key: 'items',
      title: '商品 / 积分',
      width: 180,
      render: (row) => {
        const credits = row.grantedCredits > 0 ? `+${row.grantedCredits} 积分` : '无积分';
        return row.membershipPlanName ? (
          <div className="flex flex-col gap-0.5">
            <span className="max-w-[170px] truncate" title={row.membershipPlanName}>
              {row.membershipPlanName}
            </span>
            <span
              className="max-w-[170px] truncate text-[11px] text-text-tertiary"
              title={`${row.membershipPlanCode} · ${credits}`}
            >
              {row.membershipPlanCode} · {credits}
            </span>
          </div>
        ) : (
          <div className="flex flex-col gap-0.5 text-[11px] text-text-tertiary">
            <span>{row.itemCount} 件商品</span>
            <span>{credits}</span>
          </div>
        );
      },
    },
    {
      key: 'paidAt',
      title: '支付时间',
      width: 150,
      render: (row) =>
        row.paidAt ? (
          <span className="text-xs tabular-nums">{new Date(row.paidAt).toLocaleString('zh-CN')}</span>
        ) : (
          <span className="text-[11px] text-text-tertiary">未支付</span>
        ),
    },
    {
      key: 'ops',
      title: '',
      width: 130,
      /* 固定在最右, 保证滚动时高频动作仍可见 */
      fixed: 'right',
      render: (row) => (
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="small" onClick={() => setDetailId(row.id)}>
            详情
          </Button>
          {/*
           * 动作按状态出现而非置灰: 「未支付才能核销」「已支付才能退款」都是
           * 后端硬校验, 给一个点不动的按钮只会让人反复试。
           */}
          {row.status === 'pending' && can('order.mark_paid') && (
            <Button variant="ghost" size="small" onClick={() => openAction('markPaid', row)}>
              核销
            </Button>
          )}
          {(row.status === 'paid' || row.status === 'partial_refunded') &&
            row.paidCents > row.refundedCents &&
            can('order.refund') && (
              <Button
                variant="ghost"
                size="small"
                className="text-rose-600"
                onClick={() => openAction('refund', row)}
              >
                退款
              </Button>
            )}
        </div>
      ),
    },
  ];

  const detailFetcher = useCallback(async () => {
    if (!detailId) throw new Error('订单不存在');
    return adminOrdersApi.detail(detailId);
  }, [detailId]);

  return (
    <>
      <PageHeader
        title="订单管理"
        description="订单、支付与退款。核销与退款会写入操作审计，并即时回收或发放积分。"
        actions={
          can('data.export') ? (
            <Button
              variant="secondary"
              size="small"
              leadingIcon={Download}
              disabled={exporting}
              onClick={() => void exportCsv()}
            >
              {exporting ? '导出中…' : '导出 CSV'}
            </Button>
          ) : undefined
        }
      />

      <FilterBar>
        <SelectBox
          className="w-32"
          ariaLabel="按状态筛选"
          placeholder="状态"
          allowClear
          value={status}
          onChange={setStatus}
          options={STATUS_OPTIONS}
        />
        <TextInput
          className="w-44"
          ariaLabel="按订单号搜索"
          placeholder="订单号"
          value={orderNo}
          onChange={setOrderNo}
          onEnter={applyQuery}
          allowClear
        />
        {/*
         * 邮箱而非用户 ID: 客服拿到的是用户自报的邮箱。用 ID 意味着先查用户
         * 再查订单, 多一步且该用户未必记得自己的 id。
         */}
        <TextInput
          className="w-52"
          ariaLabel="按用户邮箱搜索"
          placeholder="用户邮箱"
          value={email}
          onChange={setEmail}
          onEnter={applyQuery}
          allowClear
        />
        <SelectBox
          className="w-32"
          ariaLabel="按渠道筛选"
          placeholder="渠道"
          allowClear
          value={channel}
          onChange={setChannel}
          options={Object.entries(CHANNEL_LABELS).map(([value, label]) => ({ value, label }))}
        />
        {/*
         * 退款状态是 Refund 维度，订单仍可能显示 paid —— 这正是渠道异步退款
         * 需要人工核对的场景。告警中心 `?refundState=processing` 直达这里。
         */}
        <SelectBox
          className="w-36"
          ariaLabel="按退款状态筛选"
          placeholder="退款状态"
          allowClear
          value={refundState}
          onChange={setRefundState}
          options={REFUND_STATE_OPTIONS}
        />
        <TextInput
          className="w-40"
          ariaLabel="开始日期"
          type="date"
          value={from}
          onChange={setFrom}
        />
        <TextInput className="w-40" ariaLabel="结束日期" type="date" value={to} onChange={setTo} />
        <FilterActions>
          <Button variant="primary" size="small" onClick={applyQuery}>
            查询
          </Button>
          <Button variant="secondary" size="small" onClick={reset}>
            重置
          </Button>
        </FilterActions>
        <AppliedFilters items={appliedChips} onClearAll={reset} />
      </FilterBar>

      {/* 刷新失败但手上还有上一次的数据: 只挂提示, 不把整个列表藏起来 */}
      {error && data && <AdminStaleError error={error} onRetry={reload} />}

      <Panel title="订单列表" note="日期筛选含结束当天；导出口径与当前筛选一致">
        {/* 批量条贴在表头上方: 勾选后要立即看到「能动多少笔」 */}
        {selected.length > 0 && (
          <div
            role="status"
            className="mb-3 flex items-center gap-3 rounded-lg border border-accent-200 bg-accent-50 px-3 py-2"
          >
            <span className="min-w-0 flex-1 text-xs text-accent-900">已选 {selected.length} 单</span>
            {can('order.mark_paid') && (
              <Button
                variant="primary"
                size="small"
                disabled={busy}
                onClick={() => {
                  setReason('');
                  setBatchOpen(true);
                }}
              >
                批量核销
              </Button>
            )}
            <Button variant="ghost" size="small" onClick={() => setSelected([])}>
              清空选择
            </Button>
          </div>
        )}

        <AdminDataTable<AdminOrderRow>
          rows={list?.items ?? []}
          columns={columns}
          rowKey={(row) => row.id}
          loading={loading}
          error={error}
          onRetry={reload}
          minWidth={1090}
          selectable
          selected={selected}
          onSelectedChange={setSelected}
          // 只有待支付能核销; 已支付/已退款选中后再点批量核销只会得到一堆失败项
          isRowSelectable={(row) => row.status === 'pending'}
          pagination={{
            current: list?.page ?? 1,
            pageSize: list?.pageSize ?? 20,
            total: list?.total ?? 0,
            unit: '单',
            // 翻页清空选择: 批量核销/退款只应对看得见的行下手
            onChange: (page, size) => {
              setSelected([]);
              setPage(page, size);
            },
          }}
          emptyText={
            hasFilter
              ? '没有符合条件的订单。清除筛选或换一个时间范围试试。'
              : '还没有订单。用户下单后会出现在这里。'
          }
          emptyAction={
            hasFilter ? (
              <Button variant="secondary" size="small" onClick={reset}>
                清除筛选
              </Button>
            ) : undefined
          }
        />
      </Panel>

      <AdminDrawer<AdminOrderDetail>
        open={detailId !== null}
        title="订单详情"
        onClose={() => setDetailId(null)}
        fetcher={detailFetcher}
        footer={(d) => {
          const row = list?.items.find((o) => o.id === d.id);
          if (!row) return null;
          const canMarkPaid = d.status === 'pending' && can('order.mark_paid');
          const canRefund =
            (d.status === 'paid' || d.status === 'partial_refunded') &&
            d.paidCents > d.refundedCents &&
            can('order.refund');
          // 无可执行动作时不渲染空页脚，避免详情底部留下无意义的空白操作条
          if (!canMarkPaid && !canRefund) return null;
          return (
            <>
              {canMarkPaid && (
                <Button
                  variant="primary"
                  size="small"
                  onClick={() => openAction('markPaid', row)}
                >
                  标记为已支付
                </Button>
              )}
              {canRefund && (
                <Button variant="danger" size="small" onClick={() => openAction('refund', row)}>
                  退款
                </Button>
              )}
            </>
          );
        }}
      >
        {(d) => (
          <div className="flex flex-col gap-6">
            <section>
              <SectionTitle title="订单概要" note="金额以「分」存储，展示按「元」" />
              <Descriptions
                columns={2}
                items={[
                  {
                    label: '订单号',
                    value: <code className="font-mono text-xs">{d.orderNo}</code>,
                  },
                  {
                    label: '状态',
                    value: <StatusTag status={d.status} label={STATUS_LABEL_OVERRIDE[d.status]} />,
                  },
                  {
                    label: '用户',
                    value: (
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span>
                          {d.user.name ? `${d.user.name} · ` : ''}
                          <Link
                            className="text-accent-700 hover:underline"
                            to={adminUserDetailHref(d.userId)}
                          >
                            {d.user.email}
                          </Link>
                        </span>
                        <Link
                          className="text-[11px] text-accent-600 hover:underline"
                          to={adminCreditHref({ userId: d.userId, email: d.user.email })}
                        >
                          积分账本
                        </Link>
                        <Link
                          className="text-[11px] text-accent-600 hover:underline"
                          to={adminTasksHref({ userId: d.userId })}
                        >
                          任务记录
                        </Link>
                      </div>
                    ),
                  },
                  {
                    label: '订单金额',
                    value: (
                      <span className="tabular-nums">
                        ¥ {yuan(d.totalCents)}（{d.totalCents} 分）
                      </span>
                    ),
                  },
                  {
                    label: '优惠',
                    value: (
                      <span>
                        ¥ {yuan(d.discountCents)}
                        {d.coupon ? ` · 券 ${d.coupon.code}` : ''}
                        {d.campaign ? ` · 活动 ${d.campaign.name}` : ''}
                      </span>
                    ),
                  },
                  { label: '实付', value: <span className="tabular-nums">¥ {yuan(d.paidCents)}</span> },
                  {
                    label: '已退',
                    value: <span className="tabular-nums">¥ {yuan(d.refundedCents)}</span>,
                  },
                  {
                    label: '发放积分',
                    value: <span className="tabular-nums">{d.grantedCredits}</span>,
                  },
                  { label: '渠道', value: d.channel ? CHANNEL_LABELS[d.channel] ?? d.channel : '—' },
                  { label: '下单时间', value: new Date(d.createdAt).toLocaleString('zh-CN') },
                  {
                    label: '支付时间',
                    value: d.paidAt ? new Date(d.paidAt).toLocaleString('zh-CN') : '未支付',
                  },
                  { label: '支付时限', value: new Date(d.expiresAt).toLocaleString('zh-CN') },
                  ...(d.membershipPlan
                    ? [
                        {
                          label: '会员套餐',
                          value: (
                            <>
                              {d.membershipPlan.name}（{d.membershipPlan.durationDays} 天 · 每月{' '}
                              {d.membershipPlan.monthlyCredits} 积分）
                              {d.membershipAppliedAt ? (
                                <span className="text-[11px] text-text-tertiary"> · 权益已发放</span>
                              ) : (
                                <span className="text-[11px] text-rose-600"> · 权益尚未发放</span>
                              )}
                            </>
                          ),
                        },
                      ]
                    : []),
                ]}
              />
            </section>

            {d.items.length > 0 && (
              <section>
                <SectionTitle title="商品明细" note="下单时的快照，不随后续改价变化" />
                <ul className="divide-y divide-border-table rounded-lg border border-border-table">
                  {d.items.map((it) => (
                    <RecordRow
                      key={it.id}
                      head={
                        <>
                          {it.nameSnapshot}{' '}
                          <code className="font-mono text-[11px] text-text-tertiary">
                            {it.skuSnapshot}
                          </code>
                        </>
                      }
                      meta={
                        <span className="tabular-nums">
                          ¥ {yuan(it.priceCentsSnapshot)} × {it.quantity} · +{it.creditsSnapshot}{' '}
                          积分
                        </span>
                      }
                    />
                  ))}
                </ul>
              </section>
            )}

            <section>
              <SectionTitle title="支付流水" note="渠道回调的原始记录" />
              {d.payments.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border-table px-3 py-4 text-center text-xs text-text-tertiary">
                  尚无支付记录。订单未支付，或渠道回调尚未到达。
                </p>
              ) : (
                <ul className="divide-y divide-border-table rounded-lg border border-border-table">
                  {d.payments.map((p) => (
                    <RecordRow
                      key={p.id}
                      state={p.status === 'succeeded' ? 'done' : 'pending'}
                      head={
                        <>
                          {CHANNEL_LABELS[p.channel] ?? p.channel} · ¥ {yuan(p.amountCents)}
                        </>
                      }
                      meta={
                        <>
                          <code className="font-mono">{p.payTransactionId}</code>
                          {p.sandboxScenario ? ` · 沙箱/${p.sandboxScenario}` : ''}
                          {p.message ? ` · ${p.message}` : ''} ·{' '}
                          {new Date(p.createdAt).toLocaleString('zh-CN')}
                        </>
                      }
                    />
                  ))}
                </ul>
              )}
            </section>

            {d.refunds.length > 0 && (
              <section>
                <SectionTitle title="退款记录" />
                <ul className="divide-y divide-border-table rounded-lg border border-border-table">
                  {d.refunds.map((r) => (
                    <RecordRow
                      key={r.id}
                      state={r.status === 'succeeded' ? 'done' : 'pending'}
                      head={
                        <>
                          ¥ {yuan(r.amountCents)}
                          {/* 失败/处理中的退款行必须显示状态: 它们没有动过订单与积分 */}
                          {r.status !== 'succeeded' && (
                            <span className="text-[11px] text-amber-700">
                              {' '}
                              · {REFUND_STATUS_LABELS[r.status] ?? r.status}
                            </span>
                          )}
                        </>
                      }
                      meta={
                        <>
                          {r.reason} · {new Date(r.createdAt).toLocaleString('zh-CN')}
                        </>
                      }
                    />
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}
      </AdminDrawer>

      {action && (
        <ConfirmAction
          open
          title={action.kind === 'markPaid' ? '手工核销订单' : '订单退款'}
          confirmText={action.kind === 'markPaid' ? '确认已收款' : '确认退款'}
          danger={action.kind === 'refund'}
          loading={busy}
          onCancel={() => setAction(null)}
          onConfirm={() => void runAction()}
          description={
            action.kind === 'markPaid' ? (
              <>
                <p>
                  将先生成一条 <b>channel=manual</b> 的支付流水，再把订单置为已支付并发放积分/会员权益。
                </p>
                <p className="text-[11px] text-text-tertiary">
                  订单 {action.row.orderNo} · ¥ {yuan(action.row.paidCents)} ·{' '}
                  {action.row.membershipPlanName ?? `${action.row.itemCount} 件商品`}
                </p>
              </>
            ) : (
              <>
                <p>
                  退款会回收本单发放且<b>尚未被消耗</b>的积分；已被用掉的部分无法扣回，结果会如实提示。
                </p>
                <p className="text-[11px] text-text-tertiary">
                  订单 {action.row.orderNo} · 实付 ¥ {yuan(action.row.paidCents)} · 已退 ¥{' '}
                  {yuan(action.row.refundedCents)} · 可退上限 ¥{' '}
                  {yuan(Math.max(action.row.paidCents - action.row.refundedCents, 0))}
                </p>
              </>
            )
          }
          impact={
            action.kind === 'markPaid'
              ? [
                  `订单状态 → 已支付`,
                  `发放 ${action.row.grantedCredits > 0 ? action.row.grantedCredits : '（按商品配置）'} 积分`,
                  action.row.membershipPlanName ? `激活会员：${action.row.membershipPlanName}` : '不涉及会员',
                  '写操作审计（含操作人）',
                ]
              : [
                  `退款金额 ¥ ${refundYuan || '未填'}`,
                  '回收未消耗的积分（按批次剩余量）',
                  '订单状态 → 已退款 / 部分退款',
                  '写操作审计（含操作人）',
                ]
          }
          extra={
            <>
              {action.kind === 'refund' && (
                <div className="flex flex-col gap-1.5">
                  <span className="text-xs text-text-secondary">退款金额（元）</span>
                  <TextInput
                    ariaLabel="退款金额"
                    inputMode="decimal"
                    value={refundYuan}
                    onChange={setRefundYuan}
                    placeholder="0.00"
                  />
                </div>
              )}
              <div className="flex flex-col gap-1.5">
                <span className="text-xs text-text-secondary">操作原因（强制，写入审计）：</span>
                <TextInput
                  ariaLabel="操作原因"
                  value={reason}
                  onChange={setReason}
                  placeholder={
                    action.kind === 'markPaid'
                      ? '如：用户线下转账，财务已确认到账'
                      : '如：用户申请退款，商品未使用'
                  }
                  maxLength={200}
                />
              </div>
            </>
          }
        />
      )}

      {batchOpen && (
        <ConfirmAction
          open
          title={`批量核销 ${selected.length} 笔订单`}
          confirmText="确认已收款"
          loading={busy}
          onCancel={() => {
            setBatchOpen(false);
            setReason('');
          }}
          onConfirm={() => void runBatchMarkPaid()}
          description={
            <>
              <p>
                将为每笔订单生成一条 <b>channel=manual</b> 的支付流水，置为已支付并发放对应积分 / 会员权益。
              </p>
              <p className="text-[11px] text-text-tertiary">
                只处理「待支付」状态的订单；已是已支付的订单会返回幂等命中而不重复发放。
              </p>
            </>
          }
          impact={[
            `共 ${selected.length} 笔订单`,
            '每笔会生成一条手工核销流水',
            '发放对应的积分或会员权益',
            '写操作审计（含操作人与原因）',
          ]}
          extra={
            <div className="flex flex-col gap-1.5">
              <span className="text-xs text-text-secondary">操作原因（强制，写入审计）：</span>
              <TextInput
                ariaLabel="批量核销原因"
                value={reason}
                onChange={setReason}
                placeholder="如：对公转账已到账，财务批量核销"
                maxLength={200}
              />
            </div>
          }
        />
      )}

      <BatchResultModal
        open={batchSummary !== null}
        title="批量核销结果"
        summary={batchSummary}
        onClose={() => setBatchSummary(null)}
      />
    </>
  );
}
