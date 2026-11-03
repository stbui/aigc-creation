import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Download } from 'lucide-react';
import {
  ActionButton,
  AdminDataTable,
  AppliedFilters,
  BatchBar,
  BatchResultModal,
  ClearableField,
  ConfirmAction,
  FilterActions,
  FilterBar,
  PageHeader,
  Panel,
  SelectField,
  StatusTag,
  StaleError,
  TextField,
  type AdminColumn,
  type AppliedFilter,
} from '~/admin-ui/primitives';
import { adminOrdersApi } from './api';
import { useAdmin, useAdminDetailParam, useAdminList, useAdminUrlFilterSync, useToast } from './hooks';
import { adminOrderDetailHref, adminUserDetailHref, yuan, yuanToCents } from './utils';
import {
  CHANNEL_LABELS,
  CHANNEL_OPTIONS,
  REFUND_STATE_OPTIONS,
  STATUS_LABEL_OVERRIDE,
  STATUS_OPTIONS,
} from './constants';
import { OrderDetailDrawer } from './OrderDetailDrawer';
import type { AdminOrderListResult, AdminOrderRow, BatchSummary } from '../../../types/api';

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
 * 并回收积分。两者都进操作审计，审计原因由系统按操作上下文生成。
 *
 * ## 模块划分
 *
 * 详情抽屉拆到 `OrderDetailDrawer`；本文件只保留列表筛选、批量核销与写操作确认。
 */
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
  const [refundReason, setRefundReason] = useState('');
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

  const appliedStatus = params.status as string | undefined;
  const appliedRefundState = params.refundState as string | undefined;
  const appliedOrderNo = (params.orderNo as string | undefined) ?? '';
  const appliedEmail = (params.email as string | undefined) ?? '';
  const appliedChannel = params.channel as string | undefined;
  const appliedFrom = (params.from as string | undefined) ?? '';
  const appliedTo = (params.to as string | undefined) ?? '';

  /** 空态与「清除筛选」按**已生效**的查询判断，输入框草稿不算 */
  const hasFilter = Boolean(
    appliedStatus || appliedRefundState || appliedOrderNo || appliedEmail || appliedChannel || appliedFrom || appliedTo,
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
    setRefundReason('');
    // 默认退款金额 = 可退上限 (实付 - 已退)。部分退款时运营只需改小
    setRefundYuan(kind === 'refund' ? yuan(Math.max(row.paidCents - row.refundedCents, 0)) : '');
  };

  const runAction = async () => {
    if (!action) return;
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
        const reason = refundReason.trim();
        if (!reason) {
          toast.error('请填写退款原因');
          setBusy(false);
          return;
        }
        const r = await adminOrdersApi.refund(action.row.id, cents, reason);
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
        status: params.status as string | undefined,
        refundState: params.refundState as string | undefined,
        orderNo: (params.orderNo as string | undefined) || undefined,
        email: (params.email as string | undefined) || undefined,
        channel: params.channel as string | undefined,
        from: (params.from as string | undefined) || undefined,
        to: (params.to as string | undefined) || undefined,
      });
      toast.success('导出已开始下载');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '导出失败');
    } finally {
      setExporting(false);
    }
  };

  const runBatchMarkPaid = async () => {
    if (selected.length === 0) return;
    setBusy(true);
    try {
      const summary = await adminOrdersApi.batchMarkPaid(selected);
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
            className="truncate rounded font-mono text-xs font-medium text-brand hover:underline"
            to={adminOrderDetailHref(row.id)}
          >
            {row.orderNo}
          </Link>
          <span className="text-[12px] text-muted-foreground">
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
          className="block max-w-[160px] truncate text-xs text-brand hover:underline"
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
          <span className="max-w-[110px] truncate text-[12px] text-muted-foreground">
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
                  ? 'max-w-[140px] truncate text-[12px] text-danger-text'
                  : 'max-w-[140px] truncate text-[12px] text-muted-foreground'
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
              className="max-w-[170px] truncate text-[12px] text-muted-foreground"
              title={`${row.membershipPlanCode} · ${credits}`}
            >
              {row.membershipPlanCode} · {credits}
            </span>
          </div>
        ) : (
          <div className="flex flex-col gap-0.5 text-[12px] text-muted-foreground">
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
          <span className="text-[12px] text-muted-foreground">未支付</span>
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
          <ActionButton variant="ghost" size="sm" onClick={() => setDetailId(row.id)}>
            详情
          </ActionButton>
          {/*
           * 动作按状态出现而非置灰: 「未支付才能核销」「已支付才能退款」都是
           * 后端硬校验, 给一个点不动的按钮只会让人反复试。
           */}
          {row.status === 'pending' && can('order.mark_paid') && (
            <ActionButton variant="ghost" size="sm" onClick={() => openAction('markPaid', row)}>
              核销
            </ActionButton>
          )}
          {(row.status === 'paid' || row.status === 'partial_refunded') &&
            row.paidCents > row.refundedCents &&
            can('order.refund') && (
              <ActionButton
                variant="destructive"
                size="sm"
                onClick={() => openAction('refund', row)}
              >
                退款
              </ActionButton>
            )}
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="订单管理"
        description="订单、支付与退款。核销与退款会写入操作审计，并即时回收或发放积分。"
        actions={
          can('data.export') ? (
            <ActionButton
              variant="secondary"
              size="sm"
              icon={Download}
              disabled={exporting}
              onClick={() => void exportCsv()}
            >
              {exporting ? '导出中…' : '导出 CSV'}
            </ActionButton>
          ) : undefined
        }
      />

      <FilterBar>
        <SelectField
          className="w-28"
          ariaLabel="按状态筛选"
          placeholder="状态"
          allowClear
          value={status}
          onChange={setStatus}
          options={STATUS_OPTIONS}
        />
        <ClearableField
          className="w-36"
          ariaLabel="按订单号搜索"
          placeholder="订单号"
          value={orderNo}
          onChange={setOrderNo}
          onEnter={applyQuery}
        />
        {/*
         * 邮箱而非用户 ID: 客服拿到的是用户自报的邮箱。用 ID 意味着先查用户
         * 再查订单, 多一步且该用户未必记得自己的 id。
         */}
        <ClearableField
          className="w-40"
          ariaLabel="按用户邮箱搜索"
          placeholder="用户邮箱"
          value={email}
          onChange={setEmail}
          onEnter={applyQuery}
        />
        <SelectField
          className="w-28"
          ariaLabel="按渠道筛选"
          placeholder="渠道"
          allowClear
          value={channel}
          onChange={setChannel}
          options={CHANNEL_OPTIONS}
        />
        {/*
         * 退款状态是 Refund 维度，订单仍可能显示 paid —— 这正是渠道异步退款
         * 需要人工核对的场景。告警中心 `?refundState=processing` 直达这里。
         */}
        <SelectField
          className="w-28"
          ariaLabel="按退款状态筛选"
          placeholder="退款状态"
          allowClear
          value={refundState}
          onChange={setRefundState}
          options={REFUND_STATE_OPTIONS}
        />
        <TextField
          className="w-32"
          ariaLabel="开始日期"
          type="date"
          value={from}
          onChange={setFrom}
        />
        <TextField className="w-32" ariaLabel="结束日期" type="date" value={to} onChange={setTo} />
        <FilterActions>
          <ActionButton variant="default" size="sm" onClick={applyQuery}>
            查询
          </ActionButton>
          <ActionButton variant="secondary" size="sm" onClick={reset}>
            重置
          </ActionButton>
        </FilterActions>
        <AppliedFilters items={appliedChips} onClearAll={reset} />
      </FilterBar>

      {/* 刷新失败但手上还有上一次的数据: 只挂提示, 不把整个列表藏起来 */}
      {error && data && <StaleError error={error} onRetry={reload} />}

      <Panel title="订单列表" note="日期筛选含结束当天；导出口径与当前筛选一致">
        {/* 批量条贴在表头上方: 勾选后要立即看到「能动多少笔」 */}
        <BatchBar count={selected.length} unit="单">
          {can('order.mark_paid') && (
            <ActionButton
              variant="default"
              size="sm"
              disabled={busy}
              onClick={() => {
                setBatchOpen(true);
              }}
            >
              批量核销
            </ActionButton>
          )}
          <ActionButton variant="ghost" size="sm" onClick={() => setSelected([])}>
            清空选择
          </ActionButton>
        </BatchBar>

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
              <ActionButton variant="secondary" size="sm" onClick={reset}>
                清除筛选
              </ActionButton>
            ) : undefined
          }
        />
      </Panel>

      <OrderDetailDrawer
        detailId={detailId}
        rows={list?.items ?? []}
        canMarkPaid={can('order.mark_paid')}
        canRefund={can('order.refund')}
        onClose={() => setDetailId(null)}
        onAction={openAction}
      />

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
                <p className="text-[12px] text-muted-foreground">
                  订单 {action.row.orderNo} · ¥ {yuan(action.row.paidCents)} ·{' '}
                  {action.row.membershipPlanName ?? `${action.row.itemCount} 件商品`}
                </p>
              </>
            ) : (
              <>
                <p>
                  退款会回收本单发放且<b>尚未被消耗</b>的积分；已被用掉的部分无法扣回，结果会如实提示。
                </p>
                <p className="text-[12px] text-muted-foreground">
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
                  '订单状态 → 已支付',
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
                <>
                  <div className="flex flex-col gap-1.5">
                    <span className="text-xs text-muted-foreground">退款金额（元）</span>
                    <TextField
                      ariaLabel="退款金额"
                      inputMode="decimal"
                      value={refundYuan}
                      onChange={setRefundYuan}
                      placeholder="0.00"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <span className="text-xs text-muted-foreground">退款原因</span>
                    <TextField
                      ariaLabel="退款原因"
                      value={refundReason}
                      onChange={setRefundReason}
                      placeholder="如：用户申请退款，已核实订单"
                      maxLength={200}
                    />
                  </div>
                </>
              )}
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
          onCancel={() => setBatchOpen(false)}
          onConfirm={() => void runBatchMarkPaid()}
          description={
            <>
              <p>
                将为每笔订单生成一条 <b>channel=manual</b> 的支付流水，置为已支付并发放对应积分 / 会员权益。
              </p>
              <p className="text-[12px] text-muted-foreground">
                只处理「待支付」状态的订单；已是已支付的订单会返回幂等命中而不重复发放。
              </p>
            </>
          }
          impact={[
            `共 ${selected.length} 笔订单`,
            '每笔会生成一条手工核销流水',
            '发放对应的积分或会员权益',
            '写操作审计（含操作人）',
          ]}
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
