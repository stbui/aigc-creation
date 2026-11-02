import { ConfirmAction, TextField } from './components';
import { Field } from './ChannelField';

interface DeleteReasonConfirmProps {
  open: boolean;
  title: string;
  description: string;
  impact: string[];
  /** 变更原因：高危动作的审计必填项 */
  reason: string;
  /** 输入框的无障碍名：同页多个删除入口时要能区分（如「批量删除原因」） */
  reasonAriaLabel: string;
  reasonLabel?: string;
  reasonHint?: string;
  reasonPlaceholder?: string;
  confirmText?: string;
  loading?: boolean;
  onReasonChange: (value: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * 删除类高危动作的「原因 + 确认」操作条。
 *
 * 渠道删除、模型删除、批量删除共用同一份结构：原因必填是审计要求，
 * 三个入口各写一遍容易出现某一个漏判「空原因」。
 */
export function DeleteReasonConfirm({
  open,
  title,
  description,
  impact,
  reason,
  reasonAriaLabel,
  reasonLabel = '删除原因',
  reasonHint = '写入审计：审计要能回答「谁为什么删」',
  reasonPlaceholder = '如：上游账号停用',
  confirmText,
  loading = false,
  onReasonChange,
  onCancel,
  onConfirm,
}: DeleteReasonConfirmProps) {
  const missingReason = reason.trim().length === 0;

  return (
    <ConfirmAction
      open={open}
      title={title}
      description={description}
      impact={impact}
      danger
      loading={loading}
      confirmText={confirmText}
      confirmDisabled={missingReason}
      onCancel={onCancel}
      onConfirm={onConfirm}
      extra={
        <Field
          label={reasonLabel}
          hint={reasonHint}
          error={missingReason ? '删除是高危操作，必须填写原因' : null}
        >
          <TextField
            ariaLabel={reasonAriaLabel}
            value={reason}
            onChange={onReasonChange}
            placeholder={reasonPlaceholder}
          />
        </Field>
      }
    />
  );
}
