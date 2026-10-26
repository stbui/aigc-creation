import { useCallback, useEffect, useRef, useState } from 'react';
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
 */

const STATUS_LABEL: Record<OrderStatus, string> = {
  pending: '待支付',
  paid: '已支付',
  cancelled: '已取消',
  refunded: '已退款',
  partial_refunded: '部分退款',
};

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

      {orders.map((o) => {
        const payable = canPay(o);
        return (
          <article key={o.id} className="order-card">
            <div className="order-card-head">
              <span className="order-no">{o.orderNo}</span>
              <span className={`order-status is-${o.status}`}>{STATUS_LABEL[o.status]}</span>
            </div>

            <div className="order-items">
              {/*
                会员订单**没有 OrderItem** —— 套餐不是商品, 下单时只记
                `membershipPlanId`。这里按订单上的套餐快照渲染, 否则会员单
                会显示成一张没有明细的空卡片。
              */}
              {o.membershipPlanId && (
                <div className="order-item">
                  <span>
                    <span className="order-item-name">{o.membershipPlanName ?? '会员套餐'}</span>
                    <span className="order-item-meta"> 会员订阅 · 支付后立即生效</span>
                  </span>
                  <span>{formatYuan(o.totalCents)}</span>
                </div>
              )}
              {o.items.map((it) => (
                <div key={it.id} className="order-item">
                  <span>
                    <span className="order-item-name">{it.name}</span>
                    <span className="order-item-meta">
                      {' '}
                      × {it.quantity} · {it.credits} 积分
                      {it.validDays > 0 ? ` · ${it.validDays} 天有效` : ' · 永久有效'}
                    </span>
                  </span>
                  <span>{formatYuan(it.priceCents * it.quantity)}</span>
                </div>
              ))}
            </div>

            {/*
             * 退款如实展示「已消耗无法追回」的部分。
             * 隐去这一栏会让用户以为系统吞了积分 —— 那部分是他自己用掉的,
             * 账说清楚才不会有客服工单。
             */}
            {o.refunds.length > 0 && (
              <div className="order-items">
                {o.refunds.map((r) => (
                  <div key={r.id} className="order-item">
                    <span className="order-item-meta">
                      退款 {formatYuan(r.amountCents)} · 扣回 {r.creditsReclaimed} 积分
                      {r.creditsUnreclaimable > 0 && `（已消耗 ${r.creditsUnreclaimable} 无法追回）`}
                      · {r.reason}
                    </span>
                  </div>
                ))}
              </div>
            )}

            <div className="order-card-foot">
              <span className="order-item-meta">
                {o.status === 'pending' && (
                  <>有效至 {formatDate(o.expiresAt)}</>
                )}
                {o.paidAt && <>支付于 {formatDate(o.paidAt)}</>}
                {o.status === 'paid' && o.grantedCredits > 0 && (
                  <>已到账 {o.grantedCredits} 积分</>
                )}
                {o.membershipPlanId && o.status === 'paid' && (
                  <>{o.membershipAppliedAt ? '会员权益已生效' : '会员权益发放中'}</>
                )}
              </span>
              <span className="order-amount">
                {o.discountCents > 0 && (
                  <span className="order-item-meta" style={{ marginRight: 8 }}>
                    -{formatYuan(o.discountCents)}
                  </span>
                )}
                {formatYuan(o.paidCents)}
              </span>
            </div>

            {payable && (
              <div className="pkg-result-actions order-pay-actions" style={{ marginTop: 12 }}>
                <button
                  type="button"
                  className="pkg-result-btn is-primary"
                  onClick={() =>
                    navigate(
                      o.membershipPlanId
                        ? `/checkout/membership?orderId=${o.id}`
                        : `/checkout/${o.items[0]?.sku ?? ''}?orderId=${o.id}`,
                    )
                  }
                >
                  继续支付
                </button>
                <button
                  type="button"
                  className="pkg-result-btn"
                  disabled={cancelling === o.id}
                  onClick={() => cancelOrder(o)}
                >
                  {cancelling === o.id ? '取消中…' : '取消订单'}
                </button>
              </div>
            )}

            {/* ── 发票 ─────────────────────────────────────────────────
                只有已支付(含部分退款)的订单能开票。一单一票: 已有发票时
                不再给「申请」入口, 而是按状态展示进度或查看入口。 */}
            {(o.status === 'paid' || o.status === 'partial_refunded') && (
              <div style={{ marginTop: 12 }}>
                {(() => {
                  const inv = invoices[o.id];
                  if (!inv) {
                    return (
                      <button
                        type="button"
                        className="pkg-sandbox-btn"
                        onClick={() => {
                          setFormFor(formFor === o.id ? null : o.id);
                          setFormError(null);
                        }}
                      >
                        {formFor === o.id ? '收起开票信息' : '申请开票'}
                      </button>
                    );
                  }
                  if (inv.status === 'issued') {
                    return (
                      <button
                        type="button"
                        className="pkg-sandbox-btn"
                        onClick={() => void invoicesApi.preview(inv.id).catch(() => undefined)}
                      >
                        查看发票 {inv.invoiceNo}
                      </button>
                    );
                  }
                  if (inv.status === 'pending') {
                    return <span className="order-item-meta">发票 {inv.invoiceNo} 审核中</span>;
                  }
                  return (
                    <div>
                      <span className="order-item-meta">发票已驳回：{inv.rejectReason ?? '未说明原因'}</span>
                      <button
                        type="button"
                        className="pkg-sandbox-btn"
                        style={{ marginLeft: 8 }}
                        onClick={() => {
                          setFormFor(o.id);
                          setFormError(null);
                        }}
                      >
                        重新申请
                      </button>
                    </div>
                  );
                })()}
              </div>
            )}

            {formFor === o.id && (
              <div className="pkg-confirm-card" style={{ marginTop: 12 }}>
                <div className="pkg-confirm-row">
                  <span>抬头类型</span>
                  <Select
                    size="small"
                    style={{ width: 120 }}
                    value={form.kind}
                    onChange={(value) => setForm((f) => ({ ...f, kind: value }))}
                    options={[
                      { value: 'personal', label: '个人' },
                      { value: 'company', label: '企业' },
                    ]}
                  />
                </div>
                <div className="pkg-confirm-row">
                  <span>发票抬头</span>
                  <Input
                    size="small"
                    style={{ maxWidth: 240 }}
                    value={form.title}
                    maxLength={60}
                    onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                    placeholder={form.kind === 'company' ? '公司全称' : '个人姓名'}
                  />
                </div>
                {form.kind === 'company' && (
                  <div className="pkg-confirm-row">
                    <span>税号</span>
                    <Input
                      size="small"
                      style={{ maxWidth: 240 }}
                      value={form.taxNo}
                      maxLength={30}
                      onChange={(e) => setForm((f) => ({ ...f, taxNo: e.target.value }))}
                      placeholder="纳税人识别号"
                    />
                  </div>
                )}
                <div className="pkg-confirm-row">
                  <span>接收邮箱</span>
                  <Input
                    size="small"
                    style={{ maxWidth: 240 }}
                    value={form.email}
                    maxLength={120}
                    onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                    placeholder="选填，开具后通知"
                  />
                </div>
                <div className="pkg-confirm-row">
                  <span>开票金额</span>
                  <strong>{formatYuan(o.paidCents - o.refundedCents)}</strong>
                </div>
                {formError && (
                  <p className="pkg-pay-hint" style={{ color: '#a32d2d', textAlign: 'left' }}>
                    {formError}
                  </p>
                )}
                <button
                  type="button"
                  className="pkg-pay-btn"
                  disabled={submitting || !form.title.trim()}
                  onClick={() => void submitInvoice(o)}
                >
                  {submitting ? '提交中…' : '提交开票申请'}
                </button>
              </div>
            )}
          </article>
        );
      })}
    </PersonalPage>
  );
}
