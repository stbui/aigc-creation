import type { Order } from '../../types/api';
import { formatYuan } from './utils';
import type { InvoiceFormState } from './constants';
import { Button, Input, Select } from './components';

/**
 * 开票信息表单。
 *
 * 表单状态由页面持有（同一时间只允许一单展开），本组件只负责字段渲染与回传补丁。
 * 开票金额取 `paidCents - refundedCents` 快照，不在前端重算。
 */
export interface OrderInvoiceFormProps {
  order: Order;
  form: InvoiceFormState;
  error: string | null;
  submitting: boolean;
  onChange: (patch: Partial<InvoiceFormState>) => void;
  onCancel: () => void;
  onSubmit: () => void;
}

export function OrderInvoiceForm({
  order,
  form,
  error,
  submitting,
  onChange,
  onCancel,
  onSubmit,
}: OrderInvoiceFormProps) {
  return (
    <div className="order-invoice-form">
      <div className="order-invoice-head">
        <span className="order-invoice-title">开票信息</span>
        <span className="order-invoice-amount">
          开票金额 {formatYuan(order.paidCents - order.refundedCents)}
        </span>
      </div>
      <div className="order-invoice-grid">
        {/* Select 不能包在 <label> 里：label 会把点击二次转发给触发按钮，
            表现为「点开立刻关闭」。无障碍名走 aria-label。 */}
        <div className="order-field">
          <span>抬头类型</span>
          <Select
            value={form.kind}
            onChange={(value) => onChange({ kind: value })}
            options={[
              { value: 'personal', label: '个人' },
              { value: 'company', label: '企业' },
            ]}
            aria-label="抬头类型"
          />
        </div>
        <label className="order-field">
          <span>发票抬头</span>
          <Input
            value={form.title}
            maxLength={60}
            onChange={(e) => onChange({ title: e.target.value })}
            placeholder={form.kind === 'company' ? '公司全称' : '个人姓名'}
          />
        </label>
        {form.kind === 'company' && (
          <label className="order-field">
            <span>税号</span>
            <Input
              value={form.taxNo}
              maxLength={30}
              onChange={(e) => onChange({ taxNo: e.target.value })}
              placeholder="纳税人识别号"
            />
          </label>
        )}
        <label className="order-field">
          <span>接收邮箱</span>
          <Input
            value={form.email}
            maxLength={120}
            onChange={(e) => onChange({ email: e.target.value })}
            placeholder="选填，开具后通知"
          />
        </label>
      </div>
      {error && (
        <p className="order-form-error" role="alert">
          {error}
        </p>
      )}
      <div className="order-invoice-actions">
        <Button onClick={onCancel}>取消</Button>
        <Button
          type="primary"
          loading={submitting}
          disabled={!form.title.trim()}
          onClick={onSubmit}
        >
          提交开票申请
        </Button>
      </div>
    </div>
  );
}
