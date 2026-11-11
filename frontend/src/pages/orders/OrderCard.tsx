import type { Order } from '../../types/api';
import type { Invoice } from '../../types/payment';
import { STATUS_LABEL, type InvoiceFormState } from './constants';
import { canPay, formatDateTime, formatYuan } from './utils';
import { Button } from './components';
import { OrderInvoiceForm } from './OrderInvoiceForm';
import { OrderInvoiceStatus } from './OrderInvoiceStatus';

/**
 * 单笔订单卡片。
 *
 * 只做展示与事件回传：取数、筛选、取消订单与开票提交都留在 `page.tsx`。
 * 会员订单没有 `OrderItem`（套餐不是商品，下单时只记 `membershipPlanId`），
 * 这里按订单上的套餐快照渲染，否则会员单会显示成一张没有明细的空卡片。
 */
export interface OrderCardProps {
  order: Order;
  invoice?: Invoice;
  /** 开票表单是否展开（同一时间只允许一单展开） */
  invoiceFormOpen: boolean;
  invoiceForm: InvoiceFormState;
  invoiceFormError: string | null;
  invoiceSubmitting: boolean;
  cancelling: boolean;
  onToggleInvoiceForm: () => void;
  onReapplyInvoice: () => void;
  onInvoiceFormChange: (patch: Partial<InvoiceFormState>) => void;
  onSubmitInvoice: () => void;
  onCancel: () => void;
  onPay: () => void;
}

export function OrderCard({
  order: o,
  invoice,
  invoiceFormOpen,
  invoiceForm,
  invoiceFormError,
  invoiceSubmitting,
  cancelling,
  onToggleInvoiceForm,
  onReapplyInvoice,
  onInvoiceFormChange,
  onSubmitInvoice,
  onCancel,
  onPay,
}: OrderCardProps) {
  const payable = canPay(o);
  const invoiceable = o.status === 'paid' || o.status === 'partial_refunded';
  /*
   * 时间线与结果分开成一段文本: 原先多个 <span> 直接相邻,
   * 「支付于 …」和「已到账 …」会粘成「…15:20:00已到账 2000 积分」。
   */
  const meta: string[] = [];
  if (o.status === 'pending') meta.push(`有效至 ${formatDateTime(o.expiresAt)}`);
  if (o.paidAt) meta.push(`支付于 ${formatDateTime(o.paidAt)}`);
  if (o.status === 'paid' && o.grantedCredits > 0) meta.push(`已到账 ${o.grantedCredits} 积分`);
  if (o.membershipPlanId && o.status === 'paid') {
    meta.push(o.membershipAppliedAt ? '会员权益已生效' : '会员权益发放中');
  }
  if (o.status === 'cancelled') meta.push('未支付');
  if (o.status === 'cancelled') meta.push(`创建于 ${formatDateTime(o.createdAt)}`);
  const totalValue = o.status === 'cancelled' ? o.totalCents : o.paidCents;

  return (
    <article className="order-card">
      <div className="order-card-head">
        <span className="order-no">{o.orderNo}</span>
        <span className={`order-status is-${o.status}`}>{STATUS_LABEL[o.status]}</span>
      </div>

      <div className="order-lines">
        {o.membershipPlanId && (
          <div className="order-line">
            <div className="order-line-main">
              <span className="order-line-name">{o.membershipPlanName ?? '会员套餐'}</span>
              <span className="order-line-meta">
                {o.status === 'pending'
                  ? '会员订阅 · 支付后自动发放'
                  : o.status === 'paid' || o.status === 'partial_refunded'
                    ? o.membershipAppliedAt
                      ? '会员订阅 · 权益已生效'
                      : '会员订阅 · 权益发放中'
                    : '会员订阅 · 已结束'}
              </span>
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
                {r.creditsExpired > 0 && `（${r.creditsExpired} 已过期作废）`}
                {' · '}
                {r.reason} · {formatDateTime(r.createdAt)}
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
          <div className="order-invoice-slot">
            {invoiceable ? (
              <OrderInvoiceStatus
                invoice={invoice}
                formOpen={invoiceFormOpen}
                onToggle={onToggleInvoiceForm}
                onReapply={onReapplyInvoice}
              />
            ) : null}
          </div>
          {payable && (
            <div className="order-action-btns">
              <Button disabled={cancelling} onClick={onCancel}>
                {cancelling ? '取消中…' : '取消订单'}
              </Button>
              <Button type="primary" onClick={onPay}>
                继续支付
              </Button>
            </div>
          )}
        </div>
      )}

      {invoiceFormOpen && (
        <OrderInvoiceForm
          order={o}
          form={invoiceForm}
          error={invoiceFormError}
          submitting={invoiceSubmitting}
          onChange={onInvoiceFormChange}
          onCancel={onToggleInvoiceForm}
          onSubmit={onSubmitInvoice}
        />
      )}
    </article>
  );
}
