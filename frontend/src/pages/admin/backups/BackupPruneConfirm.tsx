import { ConfirmAction, FormField, NumberField, TextField } from './components';

interface BackupPruneConfirmProps {
  open: boolean;
  keepCount: number;
  reason: string;
  reasonError: boolean;
  rowCount: number;
  busy: boolean;
  onKeepCountChange: (value: number) => void;
  onReasonChange: (value: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}

/** 保留份数清理：批量且不可逆，是页面里唯一保留二次确认的操作 */
export function BackupPruneConfirm({
  open,
  keepCount,
  reason,
  reasonError,
  rowCount,
  busy,
  onKeepCountChange,
  onReasonChange,
  onCancel,
  onConfirm,
}: BackupPruneConfirmProps) {
  if (!open) return null;

  return (
    <ConfirmAction
      open
      title="保留份数清理"
      confirmText="执行清理"
      danger
      loading={busy}
      onCancel={onCancel}
      onConfirm={onConfirm}
      description={<p>超出保留份数的旧备份将被自动删除（仅删除已验证的备份）。</p>}
      extra={
        <div className="flex flex-col gap-3">
          <FormField label="保留份数" htmlFor="adm-keep">
            <NumberField
              value={keepCount}
              min={1}
              max={100}
              onChange={(next) => onKeepCountChange(next ?? 7)}
              ariaLabel="保留份数"
              className="w-28"
            />
          </FormField>
          <FormField
            label="清理原因（强制，写入审计）："
            htmlFor="adm-prune-reason"
            required
            error={reasonError ? '请至少填写 2 个字符的清理原因。' : null}
          >
            <TextField
              value={reason}
              onChange={onReasonChange}
              placeholder="如：季度存储容量治理"
              maxLength={200}
              ariaLabel="备份清理原因"
            />
          </FormField>
        </div>
      }
      impact={[
        `当前共 ${rowCount} 份备份`,
        `将保留最新 ${keepCount} 份已验证备份`,
        '失败与未验证的备份不在清理范围内',
        '本次操作原因会写入操作审计',
      ]}
    />
  );
}
