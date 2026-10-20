import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { ordersApi } from '../lib/api';
import { StateError, StateSkeleton } from '../components/StateViews';
import type { Order, OrderStatus } from '../types/api';

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
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setOrders(await ordersApi.list());
    } catch (e) {
      setError((e as Error).message || '订单加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="orders-page">
      <button type="button" className="pkg-back-btn" onClick={() => navigate(-1)}>
        <ArrowLeft size={14} /> 返回
      </button>

      <h1 className="orders-title">我的订单</h1>
      <p className="orders-sub">订单与支付记录，未支付订单可在有效期内继续支付</p>

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
        <p className="credits-list-empty">还没有订单</p>
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
              <div className="pkg-result-actions" style={{ marginTop: 12 }}>
                <button
                  type="button"
                  className="pkg-result-btn is-primary"
                  onClick={() => navigate(`/checkout/${o.items[0]?.sku ?? ''}?orderId=${o.id}`)}
                >
                  继续支付
                </button>
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}