import { useCallback, useEffect, useRef, useState } from 'react';
import { App, Button, Input, Select, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useSearchParams } from 'react-router-dom';
import { Download } from 'lucide-react';
import { adminOrdersApi } from '../../lib/api';
import { useAdmin } from '../../context/AdminContext';
import {
  AdminDrawer,
  AdminListError,
  AdminStaleError,
  AdminListLoading,
  ConfirmAction,
  adminPagination,
  useAdminList,
} from '../../components/admin/AdminWidgets';
import {
  AdminEmpty,
  FilterActions,
  FilterBar,
  PageHeader,
  Panel,
  StatusTag,
} from '../../components/admin/PageHeader';
import { BatchResultModal } from '../../components/admin/BatchResultModal';
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

export function AdminOrdersPage() {
  const { message } = App.useApp();
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

  const [status, setStatus] = useState<string | undefined>();
  const [refundState, setRefundState] = useState<string | undefined>(urlRefundState);
  const [orderNo, setOrderNo] = useState('');
  const [email, setEmail] = useState('');
  const [channel, setChannel] = useState<string | undefined>();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const [detailId, setDetailId] = useState<string | null>(null);
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

  const { data, loading, error, setQuery, setPage, reload } =
    useAdminList<AdminOrderListResult>(fetcher, {
      ...(urlRefundState ? { refundState: urlRefundState } : {}),
    });

  /** 顶栏搜索带 `?orderNo=` 跳过来时自动套用（ref 防止覆盖页内手动筛选） */
  const urlOrderNo = searchParams.get('orderNo') ?? '';
  const appliedOrderNo = useRef('');
  useEffect(() => {
    if (!urlOrderNo || urlOrderNo === appliedOrderNo.current) return;
    appliedOrderNo.current = urlOrderNo;
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

  const list = data;

  const hasFilter = Boolean(
    status || refundState || orderNo || email || channel || from || to,
  );

  const applyQuery = () => {
    setSelected([]);
    setQuery({
      status,
      refundState,
      orderNo: orderNo.trim() || undefined,
      email: email.trim() || undefined,
      channel,
      from: from || undefined,
      to: to || undefined,
    });
  };

  const reset = () => {
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
      void message.warning('请填写操作原因，它会写入操作审计');
      return;
    }
    setBusy(true);
    try {
      if (action.kind === 'markPaid') {
        const r = await adminOrdersApi.markPaid(action.row.id);
        void message.success(
          r.idempotentHit ? `订单已是已支付状态（${r.message ?? '幂等命中'}）` : '已标记为已支付并发放权益',
        );
      } else {
        const cents = yuanToCents(refundYuan);
        if (cents === null) {
          void message.error('退款金额格式不正确');
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
          void message.warning(r.message || '渠道已受理退款但仍在处理中，请到渠道商户后台确认');
        } else if (r.creditsUnreclaimable > 0) {
          /*
           * 积分回收结果必须显式说出来: 用户已经花掉的积分扣不回来,
           * 只提示"退款成功"会让财务以为权益也已全额回收。
           */
          void message.warning(
            `已退款 ¥${yuan(cents)}；回收积分 ${r.creditsReclaimed}，另有 ${r.creditsUnreclaimable} 积分已被消耗无法回收`,
          );
        } else {
          void message.success(`已退款 ¥${yuan(cents)}，回收积分 ${r.creditsReclaimed}`);
        }
      }
      setAction(null);
      setDetailId(null);
      reload();
    } catch (e) {
      void message.error(e instanceof Error ? e.message : '操作失败');
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
      void message.success('导出已开始下载');
    } catch (e) {
      void message.error(e instanceof Error ? e.message : '导出失败');
    } finally {
      setExporting(false);
    }
  };

  const runBatchMarkPaid = async () => {
    const trimmed = reason.trim();
    if (!trimmed) {
      void message.warning('请填写操作原因，它会写入操作审计');
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
      void message.error(e instanceof Error ? e.message : '批量核销失败');
    } finally {
      setBusy(false);
    }
  };

  const columns: ColumnsType<AdminOrderRow> = [
    {
      title: '订单号',
      key: 'orderNo',
      width: 190,
      render: (_: unknown, row) => (
        <div className="adm-cell-stack">
          <code>{row.orderNo}</code>
          <span className="adm-cell-sub">
            {new Date(row.createdAt).toLocaleString('zh-CN')}
          </span>
        </div>
      ),
    },
    {
      title: '用户',
      key: 'user',
      width: 190,
      render: (_: unknown, row) => <span className="adm-cell-sub">{row.userEmail}</span>,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (v: string) => <StatusTag status={v} label={STATUS_LABEL_OVERRIDE[v]} />,
    },
    {
      title: '实付',
      key: 'paid',
      width: 140,
      render: (_: unknown, row) => (
        <div className="adm-cell-stack">
          <span>¥ {yuan(row.paidCents)}</span>
          {/* 有退款时把已退金额摊开: 只看实付会以为这单全额到账 */}
          {row.refundedCents > 0 && (
            <span className="adm-cell-sub adm-text-danger">
              已退 ¥ {yuan(row.refundedCents)}
            </span>
          )}
        </div>
      ),
    },
    {
      title: '优惠',
      key: 'discount',
      width: 100,
      render: (_: unknown, row) =>
        row.discountCents > 0 ? (
          <span className="adm-cell-sub">- ¥ {yuan(row.discountCents)}</span>
        ) : (
          <span className="adm-cell-sub">—</span>
        ),
    },
    {
      title: '商品 / 套餐',
      key: 'items',
      width: 170,
      render: (_: unknown, row) =>
        row.membershipPlanName ? (
          <div className="adm-cell-stack">
            <span>{row.membershipPlanName}</span>
            <code className="adm-cell-sub">{row.membershipPlanCode}</code>
          </div>
        ) : (
          <span className="adm-cell-sub">{row.itemCount} 件商品</span>
        ),
    },
    {
      title: '积分',
      dataIndex: 'grantedCredits',
      key: 'grantedCredits',
      width: 90,
      render: (v: number) => (v > 0 ? `+${v}` : <span className="adm-cell-sub">—</span>),
    },
    {
      title: '渠道',
      key: 'channel',
      width: 110,
      render: (_: unknown, row) =>
        row.channel ? (
          <span className="adm-cell-sub">{CHANNEL_LABELS[row.channel] ?? row.channel}</span>
        ) : (
          <span className="adm-cell-sub">—</span>
        ),
    },
    {
      title: '支付时间',
      dataIndex: 'paidAt',
      key: 'paidAt',
      width: 160,
      render: (v: string | null) =>
        v ? new Date(v).toLocaleString('zh-CN') : <span className="adm-cell-sub">未支付</span>,
    },
    {
      title: '',
      key: 'ops',
      width: 150,
      /*
       * 固定在最右: 表格 1340 > 容器 1106, 1440 屏下「退款」按钮右边界到 1564px
       * 已被容器裁掉, 不横向滚动就只看到半个按钮 —— 退款是这页最常做的动作。
       */
      fixed: 'right',
      render: (_: unknown, row) => (
        <div className="adm-ops">
          <Button type="link" className="adm-link" onClick={() => setDetailId(row.id)}>
            详情
          </Button>
          {/*
           * 动作按状态出现而非置灰: 「未支付才能核销」「已支付才能退款」都是
           * 后端硬校验, 给一个点不动的按钮只会让人反复试。
           */}
          {row.status === 'pending' && can('order.mark_paid') && (
            <Button type="link" className="adm-link" onClick={() => openAction('markPaid', row)}>
              核销
            </Button>
          )}
          {(row.status === 'paid' || row.status === 'partial_refunded') &&
            row.paidCents > row.refundedCents &&
            can('order.refund') && (
              <Button
                type="link" danger
                className="adm-link is-danger"
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
              type="default"
              className="adm-btn"
              onClick={() => void exportCsv()}
              disabled={exporting}
            >
              <Download size={14} style={{ marginRight: 4 }} />
              {exporting ? '导出中…' : '导出 CSV'}
            </Button>
          ) : undefined
        }
      />

      <FilterBar>
        <Select
          className="adm-filter-select"
          placeholder="状态"
          allowClear
          value={status}
          onChange={setStatus}
          options={STATUS_OPTIONS}
        />
        <Input
          className="adm-filter-input"
          placeholder="订单号"
          value={orderNo}
          onChange={(e) => setOrderNo(e.target.value)}
          onPressEnter={applyQuery}
          allowClear
        />
        {/*
         * 邮箱而非用户 ID: 客服拿到的是用户自报的邮箱。用 ID 意味着先查用户
         * 再查订单, 多一步且该用户未必记得自己的 id。
         */}
        <Input
          className="adm-filter-input"
          placeholder="用户邮箱"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onPressEnter={applyQuery}
          allowClear
        />
        <Select
          className="adm-filter-select"
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
        <Select
          className="adm-filter-select"
          placeholder="退款状态"
          allowClear
          value={refundState}
          onChange={setRefundState}
          options={REFUND_STATE_OPTIONS}
        />
        <Input
          className="adm-filter-input"
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          placeholder="开始日期"
        />
        <Input
          className="adm-filter-input"
          type="date"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          placeholder="结束日期"
        />
        <FilterActions>
          <Button type="primary" className="adm-btn is-primary" onClick={applyQuery}>
            查询
          </Button>
          <Button type="default" className="adm-btn" onClick={reset}>
            重置
          </Button>
        </FilterActions>
      </FilterBar>

      {/* 刷新失败但手上还有上一次的数据: 只挂提示, 不把整个列表藏起来 */}
      {error && data && <AdminStaleError error={error} onRetry={reload} />}

      <Panel
        title="订单列表"
        note="日期筛选含结束当天；导出口径与当前筛选一致"
      >
        {loading && !data ? (
          <AdminListLoading tip="加载订单…" />
        ) : error && !data ? (
          <AdminListError error={error} onRetry={reload} />
        ) : (
          <>
            {selected.length > 0 && (
              <div className="adm-bulk-bar">
                <span className="adm-bulk-count">已选 {selected.length} 单</span>
                {can('order.mark_paid') && (
                  <Button
                    type="primary"
                    className="adm-btn is-primary"
                    disabled={busy}
                    onClick={() => {
                      setReason('');
                      setBatchOpen(true);
                    }}
                  >
                    批量核销
                  </Button>
                )}
                <Button type="link" className="adm-link" onClick={() => setSelected([])}>
                  清空选择
                </Button>
              </div>
            )}
            {(list?.items.length ?? 0) === 0 ? (
              <AdminEmpty
                description={
                  hasFilter
                    ? '没有符合条件的订单。清除筛选或换一个时间范围试试。'
                    : '还没有订单。用户下单后会出现在这里。'
                }
                action={
                  hasFilter ? (
                    <Button type="default" className="adm-btn" onClick={reset}>
                      清除筛选
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <>
                <Table<AdminOrderRow>
                rowKey="id"
                size="small"
                columns={columns}
                dataSource={list?.items ?? []}
                loading={loading}
                scroll={{ x: 1340 }}
                rowSelection={{
                  selectedRowKeys: selected,
                  onChange: (keys) => setSelected(keys as string[]),
                  // 只有待支付能核销; 已支付/已退款选中后再点批量核销只会得到一堆失败项
                  getCheckboxProps: (row) => ({ disabled: row.status !== 'pending' }),
                }}
                pagination={adminPagination({
                  current: list?.page ?? 1,
                  pageSize: list?.pageSize ?? 20,
                  total: list?.total ?? 0,
                  // 翻页清空选择: 批量核销/退款只应对看得见的行下手
                  onChange: (page, size) => {
                    setSelected([]);
                    setPage(page, size);
                  },
                })}
                />
              </>
            )}
          </>
        )}
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
            <div className="adm-ops">
              {canMarkPaid && (
                <Button
                  type="primary"
                  className="adm-btn is-primary"
                  onClick={() => openAction('markPaid', row)}
                >
                  标记为已支付
                </Button>
              )}
              {canRefund && (
                <Button
                  type="primary" danger
                  className="adm-btn is-danger"
                  onClick={() => openAction('refund', row)}
                >
                  退款
                </Button>
              )}
            </div>
          );
        }}
      >
        {(d) => (
          <>
            <div className="adm-section">
              <div className="adm-section-title">
                订单概要
                <span className="adm-panel-note">
                  金额以「分」存储，展示按「元」
                </span>
              </div>
              <dl className="adm-desc">
                <dt>订单号</dt>
                <dd>
                  <code>{d.orderNo}</code>
                </dd>
                <dt>状态</dt>
                <dd>
                  <StatusTag status={d.status} label={STATUS_LABEL_OVERRIDE[d.status]} />
                </dd>
                <dt>用户</dt>
                <dd>
                  {d.user.name ? `${d.user.name} · ` : ''}
                  {d.user.email}
                </dd>
                <dt>订单金额</dt>
                <dd>¥ {yuan(d.totalCents)}（{d.totalCents} 分）</dd>
                <dt>优惠</dt>
                <dd>
                  ¥ {yuan(d.discountCents)}
                  {d.coupon && ` · 券 ${d.coupon.code}`}
                  {d.campaign && ` · 活动 ${d.campaign.name}`}
                </dd>
                <dt>实付</dt>
                <dd>¥ {yuan(d.paidCents)}</dd>
                <dt>已退</dt>
                <dd>¥ {yuan(d.refundedCents)}</dd>
                <dt>发放积分</dt>
                <dd>{d.grantedCredits}</dd>
                <dt>渠道</dt>
                <dd>{d.channel ? (CHANNEL_LABELS[d.channel] ?? d.channel) : '—'}</dd>
                <dt>下单时间</dt>
                <dd>{new Date(d.createdAt).toLocaleString('zh-CN')}</dd>
                <dt>支付时间</dt>
                <dd>{d.paidAt ? new Date(d.paidAt).toLocaleString('zh-CN') : '未支付'}</dd>
                <dt>支付时限</dt>
                <dd>{new Date(d.expiresAt).toLocaleString('zh-CN')}</dd>
                {d.membershipPlan && (
                  <>
                    <dt>会员套餐</dt>
                    <dd>
                      {d.membershipPlan.name}（{d.membershipPlan.durationDays} 天 · 每月{' '}
                      {d.membershipPlan.monthlyCredits} 积分）
                      {d.membershipAppliedAt ? (
                        <span className="adm-cell-sub"> · 权益已发放</span>
                      ) : (
                        <span className="adm-cell-sub adm-text-danger">
                          {' '}
                          · 权益尚未发放
                        </span>
                      )}
                    </dd>
                  </>
                )}
              </dl>
            </div>

            {d.items.length > 0 && (
              <div className="adm-section">
                <div className="adm-section-title">
                  商品明细
                  <span className="adm-panel-note">下单时的快照，不随后续改价变化</span>
                </div>
                <ul className="adm-timeline">
                  {d.items.map((it) => (
                    <li key={it.id} className="adm-timeline-item is-done">
                      <span className="adm-timeline-dot" aria-hidden="true" />
                      <span className="adm-timeline-label">
                        {it.nameSnapshot} <code className="adm-cell-sub">{it.skuSnapshot}</code>
                      </span>
                      <span className="adm-cell-sub">
                        ¥ {yuan(it.priceCentsSnapshot)} × {it.quantity} · +{it.creditsSnapshot} 积分
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="adm-section">
              <div className="adm-section-title">
                支付流水
                <span className="adm-panel-note">渠道回调的原始记录</span>
              </div>
              {d.payments.length === 0 ? (
                <div className="adm-empty">
                  <p>尚无支付记录。订单未支付，或渠道回调尚未到达。</p>
                </div>
              ) : (
                <ul className="adm-timeline">
                  {d.payments.map((p) => (
                    <li key={p.id} className={`adm-timeline-item${p.status === 'succeeded' ? ' is-done' : ''}`}>
                      <span className="adm-timeline-dot" aria-hidden="true" />
                      <span className="adm-timeline-label">
                        {CHANNEL_LABELS[p.channel] ?? p.channel} · ¥ {yuan(p.amountCents)}
                      </span>
                      <span className="adm-cell-sub">
                        <code>{p.payTransactionId}</code>
                        {p.sandboxScenario ? ` · 沙箱/${p.sandboxScenario}` : ''}
                        {p.message ? ` · ${p.message}` : ''} ·{' '}
                        {new Date(p.createdAt).toLocaleString('zh-CN')}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {d.refunds.length > 0 && (
              <div className="adm-section">
                <div className="adm-section-title">退款记录</div>
                <ul className="adm-timeline">
                  {d.refunds.map((r) => (
                    <li key={r.id} className="adm-timeline-item is-done">
                      <span className="adm-timeline-dot" aria-hidden="true" />
                      <span className="adm-timeline-label">
                        ¥ {yuan(r.amountCents)}
                        {/* 失败/处理中的退款行必须显示状态: 它们没有动过订单与积分 */}
                        {r.status !== 'succeeded' && (
                          <span className="adm-cell-sub"> · {REFUND_STATUS_LABELS[r.status] ?? r.status}</span>
                        )}
                      </span>
                      <span className="adm-cell-sub">
                        {r.reason} · {new Date(r.createdAt).toLocaleString('zh-CN')}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
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
                <p className="adm-cell-sub">
                  订单 {action.row.orderNo} · ¥ {yuan(action.row.paidCents)} ·{' '}
                  {action.row.membershipPlanName ?? `${action.row.itemCount} 件商品`}
                </p>
              </>
            ) : (
              <>
                <p>
                  退款会回收本单发放且<b>尚未被消耗</b>的积分；已被用掉的部分无法扣回，结果会如实提示。
                </p>
                <p className="adm-cell-sub">
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
                <div className="adm-confirm-typing">
                  <label htmlFor="adm-refund-amount">退款金额（元）</label>
                  <Input
                    id="adm-refund-amount"
                    type="text"
                    inputMode="decimal"
                    value={refundYuan}
                    onChange={(e) => setRefundYuan(e.target.value)}
                    placeholder="0.00"
                    autoComplete="off"
                  />
                </div>
              )}
              <div className="adm-confirm-typing">
                <label htmlFor="adm-order-reason">操作原因（强制，写入审计）：</label>
                <Input
                  id="adm-order-reason"
                  type="text"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder={
                    action.kind === 'markPaid'
                      ? '如：用户线下转账，财务已确认到账'
                      : '如：用户申请退款，商品未使用'
                  }
                  maxLength={200}
                  autoComplete="off"
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
              <p className="adm-cell-sub">
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
            <div className="adm-confirm-typing">
              <label htmlFor="adm-order-batch-reason">操作原因（强制，写入审计）：</label>
              <Input
                id="adm-order-batch-reason"
                type="text"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="如：对公转账已到账，财务批量核销"
                maxLength={200}
                autoComplete="off"
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
