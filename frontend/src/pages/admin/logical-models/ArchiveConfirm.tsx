import { ConfirmDialog } from '~/admin-ui/primitives';
import type { AdminLogicalModelView } from '../../../types/model';

/**
 * 归档确认。
 *
 * 归档不是删除：模型退出 C 端目录与路由，但历史 revision、线路与账单保留，
 * 对账时仍能把每一笔扣费回溯到当时的配置。
 */
export function ArchiveConfirm({
  target,
  saving,
  onCancel,
  onConfirm,
}: {
  target: AdminLogicalModelView | null;
  saving: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <ConfirmDialog
      open={target !== null}
      title={`归档前台模型「${target?.name ?? ''}」？`}
      description="归档后不再出现在 C 端目录，历史 revision 与线路保留供账单回溯。"
      impact={[
        `当前 ${target?.routes.length ?? 0} 条线路随模型一起退出路由`,
        '已在进行中的任务不受影响，完成后按各自快照结算',
      ]}
      danger
      loading={saving}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}
