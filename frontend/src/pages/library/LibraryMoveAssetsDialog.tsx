import { useEffect, useState } from 'react';
import { FolderInput } from 'lucide-react';
import { Button, Modal, Select } from './components';
import type { ProjectListItem } from '../../types/api';

export interface LibraryMoveAssetsDialogProps {
  open: boolean;
  count: number;
  projects: ProjectListItem[];
  onCancel: () => void;
  onConfirm: (projectId: string) => Promise<void>;
}

/** 批量把选中的素材移动到另一个项目。 */
export function LibraryMoveAssetsDialog({ open, count, projects, onCancel, onConfirm }: LibraryMoveAssetsDialogProps) {
  const [projectId, setProjectId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setProjectId(projects[0]?.id ?? '');
    setBusy(false);
    setError(null);
  }, [open, projects]);

  const confirm = async () => {
    if (!projectId) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm(projectId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '移动失败，请重试');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      title="移动素材"
      width="min(460px, calc(100vw - 32px))"
      centered
      onCancel={onCancel}
      footer={null}
    >
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          将选中的 {count} 个素材移动到另一个项目。只修改素材归属，不改变任务历史。
        </p>
        {projects.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
            暂无可迁移项目，请先在项目管理中新建一个项目。
          </div>
        ) : (
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">
              目标项目
            </label>
            <Select
              value={projectId || undefined}
              onChange={(value) => setProjectId(value === undefined ? '' : String(value))}
              options={projects.map((project) => ({
                value: project.id,
                label: `${project.name}（${project.assetCount} 个素材）`,
              }))}
              placeholder="选择目标项目"
              aria-label="目标项目"
              className="w-full"
            />
          </div>
        )}
        {error && (
          <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button type="text" onClick={onCancel} disabled={busy}>取消</Button>
          <Button
            type="primary"
            icon={<FolderInput className="size-4" />}
            loading={busy}
            disabled={!projectId}
            onClick={() => void confirm()}
          >
            移动
          </Button>
        </div>
      </div>
    </Modal>
  );
}
