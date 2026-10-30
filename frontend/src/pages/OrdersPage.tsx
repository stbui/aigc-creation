import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { App, Button, Input, Select } from 'antd';
import { ShoppingBag } from 'lucide-react';
import { ordersApi, invoicesApi, paymentsApi } from '../lib/api';
import { notifyCreditsChanged } from '../context/CreditsContext';
import { useAuth } from '../context/AuthContext';
import { PersonalPage } from '../components/PersonalPage';
import { StateButton, StateEmpty, StateError, StateSkeleton } from '../components/StateViews';
import type { Invoice, Order, OrderStatus } from '../types/api';

/**
 * 我的订单。
 *
 * ⚠ **未支付订单可继续支付**: pending 状态的订单 30 分钟内有效
 * (后端 ORDER_TTL_MINUTES), 订单列表是用户回来继续付款的唯一入口 ——
 * 用户离开结算页再回来时, 不该只能重新下单。
 *
 * 列表按状态切片在客户端完成: 订单接口一次返回全部, 切档位不再请求 ——
 * 与工单页同一套筛选交互, 计数直接来自已加载数据, 不伪造。
 */

const STATUS_LABEL: Record<OrderStatus, string> = {
  pending: '待支付',
  paid: '已支付',
  cancelled: '已取消',
  refunded: '已退款',
  partial_refunded: '部分退款',
};

const FILTERS: Array<{ value: 'all' | 'pending' | 'paid' | 'refund' | 'cancelled'; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'pending', label: '待支付' },
  { value: 'paid', label: '已支付' },
  { value: 'refund', label: '退款' },
  { value: 'cancelled', label: '已取消' },
];

type FilterValue = (typeof FILTERS)[number]['value'];

/** 两种退款状态在筛选里合并成同一个档位 */
function matchesFilter(o: Order, filter: FilterValue): boolean {
  if (filter === 'all') return true;
  if (filter === 'refund') return o.status === 'refunded' || o.status === 'partial_refunded';
  return o.status === filter;
}

function formatYuan(cents: number): string {
  return `¥${(cents / 100).toFixed(2)}`;
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** 待支付订单是否还在有效期内 */
function canPay(o: Order): boolean {
  if (o.status !== 'pending') return false;
  return new Date(o.expiresAt).getTime() > Date.now();
}

export function OrdersPage() {
  const navigate = useNavigate();
  const { modal, message } = App.useApp();
  const { token, openLogin } = useAuth();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /** 已存在的发票按 orderId 索引 —— 一单一票, 后端 orderId 唯一 */
  const [invoices, setInvoices] = useState<Record<string, Invoice>>({});
  /** 正在填开票信息的订单 id */
  const [formFor, setFormFor] = useState<string | null>(null);
  const [form, setForm] = useState<{ kind: 'personal' | 'company'; title: string; taxNo: string; email: string }>({
    kind: 'personal',
    title: '',
    taxNo: '',
    email: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  /** 正在取消的订单 id，避免连点重复请求 */
  const [cancelling, setCancelling] = useState<string | null>(null);
  /** 列表状态筛选; 只影响当前视图, 不改动已加载的数据 */
  const [filter, setFilter] = useState<FilterValue>('all');

  /**
   * 拉列表。
   *
   * `silent` 用于「用户已经看着列表」的刷新（切回标签页 / 支付结果轮询）：
   * 这两处若也走 loading 态，整页会在每次切换标签时闪一次骨架屏 ——
   * 用户只是切出去看了一眼支付渠道，回来列表被清空重画。
   */
  const load = useCallback(async (opts?: { silent?: boolean }) => {
    // guest 不发请求: 订单接口要鉴权, 发了只会连着 401 又被渲染成「加载失败」。
    // 刻意不动 loading: 登录后下一帧直接是骨架屏, 不会先闪一下「还没有订单」
    if (!token) {
      setOrders([]);
      setInvoices({});
      return;
    }
    if (!opts?.silent) setLoading(true);
    setError(null);
    try {
      const list = await ordersApi.list();
      setOrders(list);
      // 发票只做展示用: 拉取失败不应该让整页报错 (订单才是主体)
      try {
        const res = await invoicesApi.list();
        const map: Record<string, Invoice> = {};
        for (const inv of res.items) map[inv.orderId] = inv;
        setInvoices(map);
      } catch {
        /* 忽略 */
      }
    } catch (e) {
      setError((e as Error).message || '订单加载失败');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * 从渠道收银台（支付宝 / 微信）跳回 `/orders` 时，订单**未必已经变成已支付**：
   * 到账由渠道的异步回调驱动，回调常常比页面加载晚 1~3 秒。
   * 浏览器无从得知，只能回问后端 —— 不回问就会看到「待支付」，而钱其实已扣。
   *
   * 只追 30 秒：更晚的回调属于少数情况，页面上的「刷新」按钮兜底，
   * 常驻轮询会让一个只是来翻订单的用户持续打接口。
   */
  const watchedRef = useRef<number | null>(null);

  useEffect(() => {
    const pending = orders.filter(
      (o) => o.status === 'pending' && new Date(o.expiresAt).getTime() > Date.now(),
    );
    if (pending.length === 0) return;

    let ticks = 0;
    watchedRef.current = window.setInterval(() => {
      // 页面在后台时不打接口：用户看不到，切回来时下面的 visibilitychange 会重新拉
      if (document.visibilityState !== 'visible') return;
      ticks += 1;
      void Promise.all(pending.map((o) => paymentsApi.status(o.id).catch(() => null))).then((res) => {
        const changed = res.some((r) => r !== null && r.status !== 'pending');
        if (!changed) {
          if (ticks >= 10 && watchedRef.current !== null) {
            window.clearInterval(watchedRef.current);
            watchedRef.current = null;
          }
          return;
        }
        // 到账 → 重拉列表并同步顶栏余额（充值积分这时才真的出现）
        notifyCreditsChanged();
        void load({ silent: true });
      });
    }, 3000);

    return () => {
      if (watchedRef.current !== null) {
        window.clearInterval(watchedRef.current);
        watchedRef.current = null;
      }
    };
  }, [orders, load]);

  /**
   * 页面重新可见 / 从 bfcache 恢复时重拉一次。
   * 外部跳转回来不保证组件重新挂载，只靠首屏那一次拉取会一直显示旧状态。
   */
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load({ silent: true });
    };
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) void load({ silent: true });
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('pageshow', onPageShow);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pageshow', onPageShow);
    };
  }, [load]);

  /** 各状态计数: 直接来自已加载列表, 与卡片上的状态一一对应 */
  const counts = useMemo(() => {
    // 计数复用 matchesFilter, 保证「标签上的数字」与「点进去看到的卡片数」永远一致
    const acc = {} as Record<FilterValue, number>;
    for (const f of FILTERS) acc[f.value] = orders.filter((o) => matchesFilter(o, f.value)).length;
    return acc;
  }, [orders]);

  const visibleOrders = useMemo(
    () => (filter === 'all' ? orders : orders.filter((o) => matchesFilter(o, filter))),
    [orders, filter],
  );

  /*
   * guest 态: 路由对外开放, 未登录也能进来。
   * 此前直接把订单接口的 401 渲染成「订单加载失败」—— 用户以为系统坏了,
   * 实际只是没登录, 页面上还没有登录入口。
   */
  if (!token) {
    return (
      <PersonalPage title="我的订单" description="查看订单、支付记录与开票进度。">
        <StateEmpty
          title="登录后查看订单"
          desc="订单与支付记录和账号绑定，登录后可以查看历史订单并继续支付未完成的订单。"
          action={<StateButton onClick={openLogin}>登录/注册</StateButton>}
        />
      </PersonalPage>
    );
  }

  const submitInvoice = async (o: Order) => {
    setSubmitting(true);
    setFormError(null);
    try {
      const inv = await invoicesApi.create({
        orderId: o.id,
        kind: form.kind,
        title: form.title.trim(),
        taxNo: form.kind === 'company' ? form.taxNo.trim() : undefined,
        email: form.email.trim() || undefined,
      });
      setInvoices((prev) => ({ ...prev, [o.id]: inv }));
      setFormFor(null);
      setForm({ kind: 'personal', title: '', taxNo: '', email: '' });
    } catch (e) {
      setFormError((e as Error).message || '开票申请提交失败');
    } finally {
      setSubmitting(false);
    }
  };

  /**
   * 主动关闭未支付订单。
   *
   * 用户可能只是想换一单，却让旧单一直挂到 30 分钟超时。取消后**不可恢复**
   * （pending → cancelled 是终态），因此必须二次确认并说明优惠券不会被占用。
   */
  const cancelOrder = (o: Order) => {
    modal.confirm({
      title: `取消订单 ${o.orderNo}？`,
      content: '取消后订单不可恢复；优惠券只在支付成功后核销，本单不会占用券。',
      okText: '取消订单',
      cancelText: '保留订单',
      okButtonProps: { danger: true },
      onOk: async () => {
        setCancelling(o.id);
        try {
          const fresh = await ordersApi.cancel(o.id);
          setOrders((prev) => prev.map((x) => (x.id === fresh.id ? fresh : x)));
          message.success('订单已取消');
        } catch (e) {
          message.error(e instanceof Error ? e.message : '取消失败');
          throw e;
        } finally {
          setCancelling(null);
        }
      },
    });
  };

  const pendingCount = orders.filter((o) => canPay(o)).length;

  /**
   * 开票入口。一单一票: 已有发票时不再给「申请」按钮,
   * 而是按状态展示进度 (审核中 / 已开具 / 被驳回的原因)。
   */
  const renderInvoice = (o: Order) => {
    const inv = invoices[o.id];
    if (!inv) {
      return (
        <Button
          size="small"
          onClick={() => {
            setFormFor(formFor === o.id ? null : o.id);
            setFormError(null);
          }}
        >
          {formFor === o.id ? '收起开票信息' : '申请开票'}
        </Button>
      );
    }
    if (inv.status === 'issued') {
      return (
        <span className="order-invoice-state is-issued">
          发票 {inv.invoiceNo} 已开具
          <Button
            size="small"
            type="link"
            onClick={() => void invoicesApi.preview(inv.id).catch(() => undefined)}
          >
            查看
          </Button>
        </span>
      );
    }
    if (inv.status === 'pending') {
      return <span className="order-invoice-state is-pending">发票 {inv.invoiceNo} 审核中</span>;
    }
    return (
      <span className="order-invoice-state is-rejected">
        发票被驳回：{inv.rejectReason ?? '未说明原因'}
        <Button
          size="small"
          onClick={() => {
            setFormFor(o.id);
            setFormError(null);
          }}
        >
          重新申请
        </Button>
      </span>
    );
  };

  return (
    <PersonalPage
      className="orders-page"
      title="我的订单"
      description={
        pendingCount > 0
          ? `有 ${pendingCount} 笔待支付订单，请在有效期内完成支付。`
          : '订单与支付记录，未支付订单可在有效期内继续支付。'
      }
      extra={
        <Button type="primary" icon={<ShoppingBag size={15} />} onClick={() => navigate('/packages')}>
          购买积分 / 会员
        </Button>
      }
    >

      {/* 加载 / 失败 / 空 三态分开 (2026-10-20 修, 同 CreditsPage) */}
      {loading && <StateSkeleton variant="row" count={3} />}
      {!loading && error && (
        <StateError
          title="订单加载失败"
          desc="没能取回订单列表。可能是后端未启动或网络异常，重试一次即可。"
          detail={error}
          onRetry={() => void load()}
        />
      )}
      {!loading && !error && orders.length === 0 && (
        <StateEmpty
          title="还没有订单"
          desc="购买积分或开通会员后，订单与支付记录会显示在这里。"
          action={<StateButton onClick={() => navigate('/packages')}>去积分商城</StateButton>}
        />
      )}

      {/* 状态筛选: 计数直接来自已加载列表, 与卡片上的状态一一对应 */}
      {orders.length > 0 && (
        <div className="order-filters" role="tablist" aria-label="按状态筛选订单">
          {FILTERS.map((f) => {
            const active = filter === f.value;
            return (
              <button
                key={f.value}
                type="button"
                role="tab"
                aria-selected={active}
                className={`order-filter${active ? ' is-active' : ''}`}
                onClick={() => setFilter(f.value)}
              >
                {f.label}
                <span className="order-filter-count">{counts[f.value]}</span>
              </button>
            );
          })}
        </div>
      )}
      {orders.length > 0 && visibleOrders.length === 0 && (
        <p className="order-filter-empty">该状态下还没有订单</p>
      )}

      {visibleOrders.map((o) => {
        const payable = canPay(o);
        const invoiceable = o.status === 'paid' || o.status === 'partial_refunded';
        /*
         * 时间线与结果分开成一段文本: 原先多个 <span> 直接相邻,
         * 「支付于 …」和「已到账 …」会粘成「…15:20:00已到账 2000 积分」。
         */
        const meta: string[] = [];
        if (o.status === 'pending') meta.push(`有效至 ${formatDate(o.expiresAt)}`);
        if (o.paidAt) meta.push(`支付于 ${formatDate(o.paidAt)}`);
        if (o.status === 'paid' && o.grantedCredits > 0) meta.push(`已到账 ${o.grantedCredits} 积分`);
        if (o.membershipPlanId && o.status === 'paid') {
          meta.push(o.membershipAppliedAt ? '会员权益已生效' : '会员权益发放中');
        }
        if (o.status === 'cancelled') meta.push('未支付');
        if (o.status === 'cancelled') meta.push(`创建于 ${formatDate(o.createdAt)}`);
        const totalValue =
          o.status === 'cancelled' ? o.totalCents : o.paidCents;

        return (
          <article key={o.id} className="order-card">
            <div className="order-card-head">
              <span className="order-no">{o.orderNo}</span>
              <span className={`order-status is-${o.status}`}>{STATUS_LABEL[o.status]}</span>
            </div>

            <div className="order-lines">
              {/*
                会员订单**没有 OrderItem** —— 套餐不是商品, 下单时只记
                `membershipPlanId`。这里按订单上的套餐快照渲染, 否则会员单
                会显示成一张没有明细的空卡片。
              */}
              {o.membershipPlanId && (
                <div className="order-line">
                  <div className="order-line-main">
                    <span className="order-line-name">{o.membershipPlanName ?? '会员套餐'}</span>
                    <span className="order-line-meta">会员订阅 · 支付后立即生效</span>
                  </div>
                  <span className="order-line-amount">{formatYuan(o.totalCents)}</span>
                </div>
              )}
              {o.items.map((it) => (
                <div key={it.id} className="order-line">
                  <div className="order-line-main">
                    <span className="order-line-name">{it.name}</span>
                    <span className="order-line-meta">
                      × {it.quantity} · {it.credits} 积分
                      {it.validDays > 0 ? ` · ${it.validDays} 天有效` : ' · 永久有效'}
                    </span>
                  </div>
                  <span className="order-line-amount">{formatYuan(it.priceCents * it.quantity)}</span>
                </div>
              ))}

              {/*
               * 退款如实展示「已消耗无法追回」的部分。
               * 隐去这一栏会让用户以为系统吞了积分 —— 那部分是他自己用掉的,
               * 账说清楚才不会有客服工单。
               */}
              {o.refunds.map((r) => (
                <div key={r.id} className="order-line is-refund">
                  <div className="order-line-main">
                    <span className="order-line-name">退款 {formatYuan(r.amountCents)}</span>
                    <span className="order-line-meta">
                      扣回 {r.creditsReclaimed} 积分
                      {r.creditsUnreclaimable > 0 &&
                        `（${r.creditsUnreclaimable} 已消耗无法追回）`}
                      {' · '}
                      {r.reason} · {formatDate(r.createdAt)}
                    </span>
                  </div>
                </div>
              ))}
            </div>

            <div className="order-card-foot">
              <span className="order-card-meta">{meta.join(' · ')}</span>
              <div className="order-total">
                {(o.discountCents > 0 || o.refundedCents > 0) && (
                  <span className="order-total-note">
                    {o.discountCents > 0 && `优惠 -${formatYuan(o.discountCents)}`}
                    {o.discountCents > 0 && o.refundedCents > 0 && ' · '}
                    {o.refundedCents > 0 && `已退 ${formatYuan(o.refundedCents)}`}
                  </span>
                )}
                <span className="order-total-main">
                  <span className="order-total-label">
                    {o.status === 'cancelled' ? '订单金额' : o.status === 'pending' ? '应付' : '实付'}
                  </span>
                  <strong className={`order-total-value${o.status === 'cancelled' ? ' is-void' : ''}`}>
                    {formatYuan(totalValue)}
                  </strong>
                </span>
              </div>
            </div>

            {(payable || invoiceable) && (
              <div className="order-card-actions">
                {/* 发票: 一单一票, 有发票后只展示进度与查看, 不再给重复申请 */}
                <div className="order-invoice-slot">{invoiceable ? renderInvoice(o) : null}</div>
                {payable && (
                  <div className="order-action-btns">
                    <Button
                      disabled={cancelling === o.id}
                      onClick={() => cancelOrder(o)}
                    >
                      {cancelling === o.id ? '取消中…' : '取消订单'}
                    </Button>
                    <Button
                      type="primary"
                      onClick={() =>
                        navigate(
                          o.membershipPlanId
                            ? `/checkout/membership?orderId=${o.id}`
                            : `/checkout/${o.items[0]?.sku ?? ''}?orderId=${o.id}`,
                        )
                      }
                    >
                      继续支付
                    </Button>
                  </div>
                )}
              </div>
            )}

            {formFor === o.id && (
              <div className="order-invoice-form">
                <div className="order-invoice-head">
                  <span className="order-invoice-title">开票信息</span>
                  <span className="order-invoice-amount">
                    开票金额 {formatYuan(o.paidCents - o.refundedCents)}
                  </span>
                </div>
                <div className="order-invoice-grid">
                  <label className="order-field">
                    <span>抬头类型</span>
                    <Select
                      value={form.kind}
                      onChange={(value) => setForm((f) => ({ ...f, kind: value }))}
                      options={[
                        { value: 'personal', label: '个人' },
                        { value: 'company', label: '企业' },
                      ]}
                    />
                  </label>
                  <label className="order-field">
                    <span>发票抬头</span>
                    <Input
                      value={form.title}
                      maxLength={60}
                      onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                      placeholder={form.kind === 'company' ? '公司全称' : '个人姓名'}
                    />
                  </label>
                  {form.kind === 'company' && (
                    <label className="order-field">
                      <span>税号</span>
                      <Input
                        value={form.taxNo}
                        maxLength={30}
                        onChange={(e) => setForm((f) => ({ ...f, taxNo: e.target.value }))}
                        placeholder="纳税人识别号"
                      />
                    </label>
                  )}
                  <label className="order-field">
                    <span>接收邮箱</span>
                    <Input
                      value={form.email}
                      maxLength={120}
                      onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                      placeholder="选填，开具后通知"
                    />
                  </label>
                </div>
                {formError && (
                  <p className="order-form-error" role="alert">
                    {formError}
                  </p>
                )}
                <div className="order-invoice-actions">
                  <Button onClick={() => setFormFor(null)}>取消</Button>
                  <Button
                    type="primary"
                    loading={submitting}
                    disabled={!form.title.trim()}
                    onClick={() => void submitInvoice(o)}
                  >
                    提交开票申请
                  </Button>
                </div>
              </div>
            )}
          </article>
        );
      })}
    </PersonalPage>
  );
}
