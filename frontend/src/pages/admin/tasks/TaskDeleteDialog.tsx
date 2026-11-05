import { ActionButton, ModalDialog } from '~/admin-ui/primitives';

/**
 * 任务删除确认。
 *
 * 删除会同时清理子任务、产出素材和存储文件，影响范围较大。居中弹框聚焦
 * 在本次删除上，不与长表格的行操作争夺注意力。
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
    <ModalDialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !loading) onCancel();
      }}
      title={title}
      description="删除后无法恢复；如需保留生成结果，请先下载。"
      width={560}
      footer={
        <div className="flex items-center justify-end gap-2">
          <ActionButton variant="secondary" size="sm" disabled={loading} onClick={onCancel}>
            取消
          </ActionButton>
          <ActionButton
            variant="destructive"
            size="sm"
            disabled={loading}
            onClick={onConfirm}
          >
            确认删除
          </ActionButton>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-sm text-foreground">{target}</p>

        <div className="rounded-md border border-danger-soft bg-danger-soft px-3 py-2 text-xs leading-5 text-danger-text">
          <div className="font-medium">以下内容将被永久删除</div>
          <p className="mt-1">任务及子任务记录、生成结果、产出素材及对应存储文件。</p>
          <p className="mt-1 font-medium">输入素材不受影响。</p>
        </div>

        {note && <p className="text-xs leading-5 text-muted-foreground">{note}</p>}
      </div>
    </ModalDialog>
  );
}
