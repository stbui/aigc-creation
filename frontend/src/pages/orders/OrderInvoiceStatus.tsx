import type { Invoice } from '../../types/payment';
import { invoicesApi } from './api';
import { Button } from './components';

/**
 * 订单卡片上的发票状态区。
 *
 * 一单只有一张有效票：待审核、已开具、已冲红时不再给「申请」按钮；
 * 被驳回后才展示重新申请入口。表单展开与否由页面的 `formFor` 决定，
 * 这里只根据 `formOpen` 切换按钮文案。
 */
export interface OrderInvoiceStatusProps {
  invoice?: Invoice;
  /** 当前订单的开票表单是否展开 */
  formOpen: boolean;
  /** 「申请开票 / 收起开票信息」 */
  onToggle: () => void;
  /** 被驳回后的「重新申请」 */
  onReapply: () => void;
}

function previewInvoice(id: string) {
  void invoicesApi.preview(id).catch(() => undefined);
}

export function OrderInvoiceStatus({
  invoice,
  formOpen,
  onToggle,
  onReapply,
}: OrderInvoiceStatusProps) {
  if (!invoice) {
    return (
      <Button size="small" onClick={onToggle}>
        {formOpen ? '收起开票信息' : '申请开票'}
      </Button>
    );
  }
  if (invoice.status === 'issued') {
    return (
      <span className="order-invoice-state is-issued">
        发票 {invoice.invoiceNo} 已开具
        <Button size="small" type="link" onClick={() => previewInvoice(invoice.id)}>
          查看
        </Button>
      </span>
    );
  }
  if (invoice.status === 'pending') {
    return <span className="order-invoice-state is-pending">发票 {invoice.invoiceNo} 审核中</span>;
  }
  if (invoice.status === 'red_flushed') {
    return (
      <span className="order-invoice-state is-rejected">
        发票 {invoice.invoiceNo} 已冲红
        {invoice.redFlushReason ? `：${invoice.redFlushReason}` : ''}
        <Button size="small" type="link" onClick={() => previewInvoice(invoice.id)}>
          查看原件
        </Button>
      </span>
    );
  }
  return (
    <span className="order-invoice-state is-rejected">
      发票被驳回：{invoice.rejectReason ?? '未说明原因'}
      <Button size="small" onClick={onReapply}>
        重新申请
      </Button>
    </span>
  );
}
