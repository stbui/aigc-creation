import { PRIORITY_LABELS, PRIORITY_VALUES, TYPE_OPTIONS, type TicketFormState } from './constants';
import type { TicketPriority, TicketType } from '../../types/api';
import { Button, Input, Select, SelectTrigger, SelectValue, SelectContent, SelectGroup, SelectItem, Textarea } from './components';

/**
 * 新建工单表单。
 *
 * 表单状态由页面持有（`?type=` / `?compose=1` 深链也会预填），本组件只负责
 * 字段渲染与回传补丁。标题 / 描述的下限校验在页面提交前完成。
 */
export interface TicketComposeFormProps {
  form: TicketFormState;
  formError: string | null;
  submitting: boolean;
  onChange: (patch: Partial<TicketFormState>) => void;
  onCancel: () => void;
  onSubmit: () => void;
}

const FIELD = 'flex flex-col gap-1.5 text-[13px] text-muted-foreground';

export function TicketComposeForm({
  form,
  formError,
  submitting,
  onChange,
  onCancel,
  onSubmit,
}: TicketComposeFormProps) {
  return (
    <section className="mb-4 grid grid-cols-2 gap-x-4 gap-y-3.5 rounded-xl border border-border bg-card px-6 pt-[22px] pb-6 max-[900px]:grid-cols-1 max-[900px]:p-4">
      <div className="col-span-full flex flex-col gap-1 border-b border-[var(--border-row)] pb-3.5">
        <h2 className="m-0 text-[15px] font-semibold text-foreground">新建工单</h2>
        <p className="m-0 text-xs leading-[18px] text-muted-foreground">
          说明发生了什么、在哪一步发生。信息越具体，客服越不必来回追问。
        </p>
      </div>
      {/* Select 不用 <label> 包裹：label 会把点击二次转发给触发按钮（打开即关闭） */}
      <div className={FIELD}>
        问题类型
          <Select
            value={form.type}
            onValueChange={(value) => onChange({ type: value as TicketType })}
          >
            <SelectTrigger
              aria-label={'问题类型'}
              className="w-full"
            >
              <SelectValue placeholder={'请选择'} />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {TYPE_OPTIONS.map((option) => (
                  <SelectItem key={String(option.value)} value={String(option.value)}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
      </div>
      <div className={FIELD}>
        优先级
          <Select
            value={form.priority}
            onValueChange={(value) => onChange({ priority: value as TicketPriority })}
          >
            <SelectTrigger
              aria-label={'优先级'}
              className="w-full"
            >
              <SelectValue placeholder={'请选择'} />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {PRIORITY_VALUES.map((p) => ({ value: p, label: PRIORITY_LABELS[p] })).map((option) => (
                  <SelectItem key={String(option.value)} value={String(option.value)}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
      </div>
      <label className={`${FIELD} col-span-full max-[900px]:col-auto`}>
        标题
        <Input
          maxLength={80}
          value={form.subject}
          onChange={(e) => onChange({ subject: e.target.value })}
          placeholder="一句话说明问题，如：生成的主图保存后是空白"
        />
      </label>
      <label className={`${FIELD} col-span-full max-[900px]:col-auto`}>
        详细描述
        <div className="login-textarea-wrap">
          <Textarea
            className="login-textarea field-sizing-fixed"
            rows={5}
            maxLength={2000}
            value={form.content}
            onChange={(e) => onChange({ content: e.target.value })}
            placeholder="复现步骤、涉及的能力名称或订单号；有报错截图可一并描述。"
          />
          <span className="login-textarea-count is-block">{form.content.length}/2000</span>
        </div>
      </label>
      {formError && (
        <p className="col-span-full max-[900px]:col-auto m-2 mb-0 text-[13px] text-[color:var(--danger-soft-text)]">{formError}</p>
      )}
      <div className="col-span-full flex items-center justify-end gap-2 max-[900px]:col-auto max-[900px]:flex-wrap max-[900px]:[&_[data-slot=button]]:flex-[1_1_auto]">
        <Button onClick={onCancel}>取消</Button>
        <Button disabled={submitting} variant="default" onClick={onSubmit}>
          {submitting && <span className="state-spinner is-small" aria-hidden />}
          提交工单
        </Button>
      </div>
    </section>
  );
}