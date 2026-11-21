import type { Order } from '../../types/api';
import { formatYuan } from './utils';
import type { InvoiceFormState } from './constants';
import { Button, Input, Select, SelectTrigger, SelectValue, SelectContent, SelectGroup, SelectItem } from './components';

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
    <div className="mt-3 rounded-lg border border-border bg-[var(--surface-tint)] p-4">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <span className="text-[13px] font-semibold text-foreground">开票信息</span>
        <span className="text-xs text-muted-foreground">
          开票金额 {formatYuan(order.paidCents - order.refundedCents)}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-3 max-[640px]:grid-cols-1">
        {/* Select 不能包在 <label> 里：label 会把点击二次转发给触发按钮，
            表现为「点开立刻关闭」。无障碍名走 aria-label。 */}
        <div className="flex min-w-0 flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">抬头类型</span>
            <Select
              value={form.kind}
              onValueChange={(value) => onChange({ kind: value as 'personal' | 'company' })}
            >
              <SelectTrigger
                aria-label={'抬头类型'}
                className="w-full"
              >
                <SelectValue placeholder={'请选择'} />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {[
                    { value: 'personal', label: '个人' },
                    { value: 'company', label: '企业' },
                  ].map((option) => (
                    <SelectItem key={String(option.value)} value={String(option.value)}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
        </div>
        <label className="flex min-w-0 flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">发票抬头</span>
          <Input
            value={form.title}
            maxLength={60}
            onChange={(e) => onChange({ title: e.target.value })}
            placeholder={form.kind === 'company' ? '公司全称' : '个人姓名'}
          />
        </label>
        {form.kind === 'company' && (
          <label className="flex min-w-0 flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">税号</span>
            <Input
              value={form.taxNo}
              maxLength={30}
              onChange={(e) => onChange({ taxNo: e.target.value })}
              placeholder="纳税人识别号"
            />
          </label>
        )}
        <label className="flex min-w-0 flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">接收邮箱</span>
          <Input
            value={form.email}
            maxLength={120}
            onChange={(e) => onChange({ email: e.target.value })}
            placeholder="选填，开具后通知"
          />
        </label>
      </div>
      {error && (
        <p className="mt-2.5 mb-0 text-xs leading-[18px] text-danger-text" role="alert">
          {error}
        </p>
      )}
      <div className="mt-3.5 flex justify-end gap-2 max-[640px]:[&_[data-slot=button]]:flex-1">
        <Button onClick={onCancel}>取消</Button>
        <Button
          variant="default"
          disabled={!form.title.trim() || submitting}
          onClick={onSubmit}
        >
          {submitting && <span className="state-spinner is-small" aria-hidden />}
          提交开票申请
        </Button>
      </div>
    </div>
  );
}
