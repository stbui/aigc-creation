import { ConfirmDialog } from '~/admin-ui/primitives';
import type { AdminLogicalModelView } from '../../../types/model';

/**
 * 移除售卖确认。
 *
 * 移除售卖不是删除：配置退出 C 端目录与消费关系，但历史版本、模型商品与账单保留，
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
      title={`移除售卖「${target?.name ?? ''}」？`}
      description="移除后不再出现在 C 端目录，历史版本与模型商品关系保留供账单回溯。"
      impact={[
        `当前 ${target?.routes.length ?? 0} 个模型商品不再被该能力使用`,
        '已在进行中的任务不受影响，完成后按各自快照结算',
      ]}
      danger
      loading={saving}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}
