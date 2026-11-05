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
  loading,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  target: string;
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
      description="删除后不可恢复，请确认影响范围。"
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
            确认永久删除
          </ActionButton>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <div>
          <p className="text-sm text-foreground">
            将永久删除<b>任务记录、子任务及其产出素材</b>，产出文件也会从存储中清理。
          </p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            输入素材不会被删除。{target}
          </p>
        </div>

        <div className="rounded-md border border-danger-soft bg-danger-soft px-3 py-2 text-xs leading-5 text-danger-text">
          <div className="font-medium">影响范围</div>
          <ul className="mt-1 list-disc pl-4">
            <li>任务及其子任务记录会被永久删除</li>
            <li>产出素材与存储文件会一并清理</li>
            <li>不可恢复，输入素材保留</li>
          </ul>
        </div>

      </div>
    </ModalDialog>
  );
}
