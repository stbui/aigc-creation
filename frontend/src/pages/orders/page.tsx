import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShoppingBag } from 'lucide-react';
import type { Order, OrderStatus } from '../../types/api';
import type { Invoice } from '../../types/payment';
import {
  EMPTY_INVOICE_FORM,
  FILTERS,
  PAGE_SIZE,
  type FilterValue,
  type InvoiceFormState,
} from './constants';
import { invoicesApi, ordersApi, paymentsApi } from './api';
import { useApp, useAuth, useDocumentMeta } from './hooks';
import { canPay, matchesFilter, notifyCreditsChanged } from './utils';
import { PersonalPage, StateButton, StateEmpty, StateError, StateSkeleton, Button } from './components';
import { OrderCard } from './OrderCard';
import { OrdersFilterBar } from './OrdersFilterBar';

/**
 * 我的订单。
 *
 * ⚠ **未支付订单可继续支付**: pending 状态的订单 30 分钟内有效
 * (后端 ORDER_TTL_MINUTES), 订单列表是用户回来继续付款的唯一入口 ——
 * 用户离开结算页再回来时, 不该只能重新下单。
 *
 * 列表由服务端分页（limit/offset + total）。状态筛选在当前已加载页上切片，
 * 「加载更多」会继续取下一页；筛选标签上的数量来自后端 statusCounts，
 * 不再是“已加载这 20 条里有多少”的误导性数字。
 *
 * 分层（见 `docs/frontend-module-conventions.md`）:
 * 路由级状态与写操作留在本文件，卡片 / 筛选条 / 开票表单与状态各自成组件，
 * 常量、接口、hook、纯函数分别走 `constants` / `api` / `hooks` / `utils`。
 */
export function OrdersPage() {
  useDocumentMeta('我的订单 · 货觉AI', '查看订单、支付记录与开票进度。');
  const navigate = useNavigate();
  const { modal, message } = useApp();
  const { token, openLogin } = useAuth();
  const [orders, setOrders] = useState<Order[]>([]);
  const [total, setTotal] = useState(0);
  const [statusCounts, setStatusCounts] = useState<Partial<Record<OrderStatus, number>>>({});
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 已加载条数（同步镜像，加载更多时作为 offset，避免闭包读到旧 state） */
  const loadedCountRef = useRef(0);

  /** 每单展示当前有效票；被驳回后后端允许重新申请，历史记录保留 */
  const [invoices, setInvoices] = useState<Record<string, Invoice>>({});
  /** 正在填开票信息的订单 id */
  const [formFor, setFormFor] = useState<string | null>(null);
  const [form, setForm] = useState<InvoiceFormState>(EMPTY_INVOICE_FORM);
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
  const load = useCallback(async (opts?: { silent?: boolean; append?: boolean }) => {
    // guest 不发请求: 订单接口要鉴权, 发了只会连着 401 又被渲染成「加载失败」。
    // 刻意不动 loading: 登录后下一帧直接是骨架屏, 不会先闪一下「还没有订单」
    if (!token) {
      setOrders([]);
      setTotal(0);
      setStatusCounts({});
      loadedCountRef.current = 0;
      setInvoices({});
      return;
    }
    const append = Boolean(opts?.append);
    const offset = append ? loadedCountRef.current : 0;
    /*
     * 静默刷新（切回标签页 / 支付轮询）要保留用户已经加载的页数，
     * 否则会把“加载更多”拉出来的历史订单又缩回第一页。
     */
    const limit = append ? PAGE_SIZE : Math.max(PAGE_SIZE, loadedCountRef.current);
    if (append) setLoadingMore(true);
    else if (!opts?.silent) setLoading(true);
    setError(null);
    try {
      const res = await ordersApi.list({ limit, offset });
      setOrders((prev) => (append ? [...prev, ...res.items] : res.items));
      loadedCountRef.current = offset + res.items.length;
      setTotal(res.total);
      setStatusCounts(res.statusCounts ?? {});
      // 发票只做展示用: 拉取失败不应该让整页报错 (订单才是主体)
      try {
        const invoiceRes = await invoicesApi.list();
        const map: Record<string, Invoice> = {};
        // 后端按创建时间倒序返回；每单只展示最新一张，避免历史驳回单覆盖当前票。
        for (const inv of invoiceRes.items) {
          if (!map[inv.orderId]) map[inv.orderId] = inv;
        }
        setInvoices(map);
      } catch {
        /* 忽略 */
      }
    } catch (e) {
      setError((e as Error).message || '订单加载失败');
    } finally {
      setLoading(false);
      setLoadingMore(false);
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

  /**
   * 各状态计数来自后端 statusCounts（全量真实数量），
   * 不是对当前已加载页做本地统计 —— 后者会随着分页把数量越报越少。
   */
  const counts = useMemo(() => {
    const acc = {} as Record<FilterValue, number>;
    for (const f of FILTERS) {
      if (f.value === 'all') {
        acc[f.value] = total;
      } else if (f.value === 'refund') {
        acc[f.value] = (statusCounts.refunded ?? 0) + (statusCounts.partial_refunded ?? 0);
      } else {
        acc[f.value] = statusCounts[f.value] ?? 0;
      }
    }
    return acc;
  }, [statusCounts, total]);

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
      setForm(EMPTY_INVOICE_FORM);
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

  /** 开票入口：同一时间只展开一单，收起或切换时清掉上一单的错误 */
  const toggleInvoiceForm = (orderId: string) => {
    setFormFor((current) => (current === orderId ? null : orderId));
    setFormError(null);
  };

  /** 被驳回后重新申请：直接打开该单表单 */
  const openInvoiceForm = (orderId: string) => {
    setFormFor(orderId);
    setFormError(null);
  };

  const continuePay = (o: Order) => {
    navigate(
      o.membershipPlanId
        ? `/checkout/membership?orderId=${o.id}`
        : `/checkout/${o.items[0]?.sku ?? ''}?orderId=${o.id}`,
    );
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

      {/* 状态筛选: 计数来自后端全量统计, 与卡片上的状态一一对应 */}
      {orders.length > 0 && (
        <OrdersFilterBar filter={filter} counts={counts} onChange={setFilter} />
      )}
      {orders.length > 0 && visibleOrders.length === 0 && (
        <p className="order-filter-empty">该状态下还没有订单</p>
      )}

      {visibleOrders.map((o) => (
        <OrderCard
          key={o.id}
          order={o}
          invoice={invoices[o.id]}
          invoiceFormOpen={formFor === o.id}
          invoiceForm={form}
          invoiceFormError={formError}
          invoiceSubmitting={submitting}
          cancelling={cancelling === o.id}
          onToggleInvoiceForm={() => toggleInvoiceForm(o.id)}
          onReapplyInvoice={() => openInvoiceForm(o.id)}
          onInvoiceFormChange={(patch) => setForm((f) => ({ ...f, ...patch }))}
          onSubmitInvoice={() => void submitInvoice(o)}
          onCancel={() => cancelOrder(o)}
          onPay={() => continuePay(o)}
        />
      ))}

      {!loading && !error && orders.length > 0 && orders.length < total && (
        <div className="order-load-more">
          <Button loading={loadingMore} onClick={() => void load({ append: true })}>
            加载更多订单（已加载 {orders.length} / {total}）
          </Button>
        </div>
      )}
    </PersonalPage>
  );
}
