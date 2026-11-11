import { ConfirmDialog } from '~/admin-ui/primitives';

/**
 * 任务删除确认。
 *
 * 删除会同时清理子任务、产出素材和存储文件，影响范围较大，因此走
 * `ConfirmDialog`（AlertDialog）：遮罩点击不会误关、Esc 除外，焦点锁在
 * 本次删除上。此前这里的危险确认是手写的 `ModalDialog` + `destructive`
 * 按钮 —— 与全站其它删除确认相比，点遮罩就会关掉，「取消」和「关掉」
 * 变成两种语义相同的动作。
 */
export function TaskDeleteDialog({
  open,
  title,
  target,
  note,
  loading,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  target: string;
  note?: string;
  loading: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <ConfirmDialog
      open={open}
      title={title}
      description={
        <>
          <p className="font-medium text-foreground">{target}</p>
          <p>删除后无法恢复；如需保留生成结果，请先下载。</p>
          {note && <p className="text-xs text-muted-foreground">{note}</p>}
        </>
      }
      impact={[
        '任务及子任务记录、生成结果、产出素材及对应存储文件',
        '输入素材不受影响',
      ]}
      danger
      confirmText="确认删除"
      loading={loading}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}
