import {
  FormDrawer,
  FormField,
  SelectField,
  SwitchField,
  TextAreaField,
  TextField,
} from './components';
import { BUILTIN_CODES, CHANNEL_LABEL, CHANNEL_OPTIONS } from './constants';
import type { MessageTemplateItem } from '../../../types/api';

/** 模板表单：页面持有状态，抽屉只负责渲染与回写。 */
export interface TemplateForm {
  code: string;
  channel: MessageTemplateItem['channel'];
  subject: string;
  body: string;
  enabled: boolean;
}

/**
 * 新建 / 编辑消息模板抽屉。
 *
 * 编码与通道绑定业务事件，建好后禁用不让改；正文留 6 行，长文案不把操作区挤走。
 * 未保存修改的关闭确认由 `FormDrawer` 统一处理，页面只传裸 `onClose`。
 */
export function TemplateDrawer({
  open,
  editing,
  form,
  dirty,
  saving,
  formError,
  onClose,
  onSubmit,
  onFormChange,
}: {
  open: boolean;
  editing: MessageTemplateItem | null;
  form: TemplateForm;
  dirty: boolean;
  saving: boolean;
  formError: string | null;
  onClose: () => void;
  onSubmit: () => void;
  onFormChange: (updater: (form: TemplateForm) => TemplateForm) => void;
}) {
  return (
    <FormDrawer
      open={open}
      onClose={onClose}
      size="md"
      title={editing ? `编辑模板 ${editing.code}` : '新建消息模板'}
      busy={saving}
      dirty={dirty}
      formError={formError}
      onSubmit={onSubmit}
    >
      <FormField
        label="模板编码"
        hint={`编码与业务事件绑定，建好后不要改。可用编码：${BUILTIN_CODES.map((c) => c.code).join('、')}`}
      >
        <TextField
          ariaLabel="模板编码"
          className="w-[240px]"
          value={form.code}
          maxLength={60}
          disabled={!!editing}
          placeholder="如 task_failed"
          onChange={(value) => onFormChange((f) => ({ ...f, code: value }))}
        />
      </FormField>

      <FormField label="通道">
        <SelectField
          ariaLabel="通道"
          className="w-[200px]"
          value={form.channel}
          disabled={!!editing}
          onChange={(value) =>
            onFormChange((f) => ({ ...f, channel: (value ?? 'inapp') as MessageTemplateItem['channel'] }))
          }
          options={CHANNEL_OPTIONS}
        />
      </FormField>

      <FormField label="标题">
        <TextField
          ariaLabel="模板标题"
          value={form.subject}
          maxLength={120}
          onChange={(value) => onFormChange((f) => ({ ...f, subject: value }))}
        />
      </FormField>

      <FormField
        label="正文"
        hint={`变量占位：${BUILTIN_CODES.map((c) => `${c.code} → ${c.hint}`).join('；')}。未提供的变量原样保留，便于发现漏传。`}
      >
        <TextAreaField
          ariaLabel="模板正文"
          value={form.body}
          rows={6}
          maxLength={2000}
          onChange={(value) => onFormChange((f) => ({ ...f, body: value }))}
        />
      </FormField>

      <FormField
        label="启用"
        hint={
          form.enabled
            ? `启用中：${CHANNEL_LABEL[form.channel]}通知会优先使用本模板的文案。`
            : '已停用：系统将使用同通道可用模板或内置文案。'
        }
      >
        <SwitchField
          ariaLabel="启用"
          checked={form.enabled}
          onChange={(value) => onFormChange((f) => ({ ...f, enabled: value }))}
        />
      </FormField>
    </FormDrawer>
  );
}
