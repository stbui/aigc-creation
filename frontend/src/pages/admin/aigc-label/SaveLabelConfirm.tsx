import { ConfirmDialog } from '~/admin-ui/primitives';
import { POSITION_LABELS } from './constants';
import type { AigcLabelSpec } from '../../../types/api';

/**
 * 保存确认。
 *
 * 改的是全站每张产出图上的法定标识，因此对照展示「从什么变成什么」；
 * 审计原因由页面按操作上下文自动生成。
 */
export function SaveLabelConfirm({
  open,
  current,
  next,
  busy,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  current: AigcLabelSpec;
  next: AigcLabelSpec;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <ConfirmDialog
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
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}
