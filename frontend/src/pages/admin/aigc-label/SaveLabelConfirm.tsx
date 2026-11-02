import { ConfirmAction, FormField, TextField } from './components';
import { POSITION_LABELS } from './constants';
import type { AigcLabelSpec } from '../../../types/api';

/**
 * 保存确认。
 *
 * 改的是全站每张产出图上的法定标识，因此对照展示「从什么变成什么」，
 * 并强制填写变更原因写入审计。
 */
export function SaveLabelConfirm({
  open,
  current,
  next,
  reason,
  busy,
  onReasonChange,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  current: AigcLabelSpec;
  next: AigcLabelSpec;
  reason: string;
  busy: boolean;
  onReasonChange: (value: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <ConfirmAction
      open={open}
      title="保存 AI 标识样式"
      confirmText="保存并应用"
      loading={busy}
      description={
        <p>
          保存后立即生效，影响此后生成的每一张图片。文案与字体变化会重新生成角标位图。
        </p>
      }
      impact={[
        `可见角标：${current.enabled ? '开启' : '关闭'} → ${next.enabled ? '开启' : '关闭'}`,
        `文案：${current.text} → ${next.text}`,
        `位置：${POSITION_LABELS[current.position]} → ${POSITION_LABELS[next.position]}`,
        `宽度：${current.scalePercent}% → ${next.scalePercent}%`,
      ]}
      extra={
        <FormField label="变更原因（写入审计日志）" required>
          <TextField
            value={reason}
            onChange={onReasonChange}
            placeholder="例如：按品牌规范调整角标配色"
            maxLength={200}
            ariaLabel="变更原因"
          />
        </FormField>
      }
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}
