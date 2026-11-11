import { PRIORITY_LABELS, PRIORITY_VALUES, TYPE_OPTIONS, type TicketFormState } from './constants';
import { Button, Input, Select } from './components';

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

export function TicketComposeForm({
  form,
  formError,
  submitting,
  onChange,
  onCancel,
  onSubmit,
}: TicketComposeFormProps) {
  return (
    <section className="ticket-compose">
      <div className="ticket-compose-head">
        <h2>新建工单</h2>
        <p>说明发生了什么、在哪一步发生。信息越具体，客服越不必来回追问。</p>
      </div>
      {/* Select 不用 <label> 包裹：label 会把点击二次转发给触发按钮（打开即关闭） */}
      <div>
        问题类型
        <Select
          value={form.type}
          onChange={(value) => onChange({ type: value })}
          options={TYPE_OPTIONS}
          aria-label="问题类型"
        />
      </div>
      <div>
        优先级
        <Select
          value={form.priority}
          onChange={(value) => onChange({ priority: value })}
          options={PRIORITY_VALUES.map((p) => ({ value: p, label: PRIORITY_LABELS[p] }))}
          aria-label="优先级"
        />
      </div>
      <label className="is-full">
        标题
        <Input
          maxLength={80}
          value={form.subject}
          onChange={(e) => onChange({ subject: e.target.value })}
          placeholder="一句话说明问题，如：生成的主图保存后是空白"
        />
      </label>
      <label className="is-full">
        详细描述
        <Input.TextArea
          rows={5}
          maxLength={2000}
          showCount
          value={form.content}
          onChange={(e) => onChange({ content: e.target.value })}
          placeholder="复现步骤、涉及的能力名称或订单号；有报错截图可一并描述。"
        />
      </label>
      {formError && <p className="ticket-error is-full">{formError}</p>}
      <div className="ticket-compose-actions">
        <Button onClick={onCancel}>取消</Button>
        <Button type="primary" loading={submitting} onClick={onSubmit}>
          提交工单
        </Button>
      </div>
    </section>
  );
}
