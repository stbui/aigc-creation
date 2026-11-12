import { useEffect, useMemo, useState } from 'react';
import { FolderOpen, Pencil, Plus, Trash2 } from 'lucide-react';
import { Button, Input, Modal, Select } from './components';
import type { ProjectListItem } from '../../types/api';

export interface LibraryProjectManagerDialogProps {
  open: boolean;
  projects: ProjectListItem[];
  currentProjectId: string | null;
  onClose: () => void;
  onCreate: (name: string) => Promise<void>;
  onRename: (id: string, name: string) => Promise<void>;
  onDelete: (project: ProjectListItem, moveAssetsTo?: string) => Promise<void>;
  onSelect: (id: string) => void;
}

/** 素材库项目管理：新建、重命名、删除，并在删除有素材的项目时选择迁移目标。 */
export function LibraryProjectManagerDialog({
  open,
  projects,
  currentProjectId,
  onClose,
  onCreate,
  onRename,
  onDelete,
  onSelect,
}: LibraryProjectManagerDialogProps) {
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<ProjectListItem | null>(null);
  const [moveTarget, setMoveTarget] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setNewName('');
    setEditingId(null);
    setEditingName('');
    setDeleteTarget(null);
    setMoveTarget(null);
    setError(null);
  }, [open]);

  const targetOptions = useMemo(
    () =>
      projects
        .filter((project) => project.id !== deleteTarget?.id)
        .map((project) => ({
          value: project.id,
          label: `${project.name}（${project.assetCount} 个素材）`,
        })),
    [deleteTarget?.id, projects],
  );

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '操作失败，请重试');
    } finally {
      setBusy(false);
    }
  };

  const create = () => {
    const name = newName.trim();
    if (!name) return;
    void run(async () => {
      await onCreate(name);
      setNewName('');
    });
  };

  const rename = () => {
    const name = editingName.trim();
    if (!editingId || !name) return;
    void run(async () => {
      await onRename(editingId, name);
      setEditingId(null);
      setEditingName('');
    });
  };

  const remove = () => {
    if (!deleteTarget) return;
    if (deleteTarget.assetCount > 0 && !moveTarget) return;
    void run(async () => {
      await onDelete(deleteTarget, moveTarget ?? undefined);
      setDeleteTarget(null);
      setMoveTarget(null);
    });
  };

  return (
    <Modal
      open={open}
      title="项目管理"
      footer={null}
      width="min(680px, calc(100vw - 32px))"
      centered
      onCancel={onClose}
      className="asset-library-project-modal"
    >
      <div className="space-y-5">
        <section className="rounded-xl border border-border bg-muted/30 p-4">
          <div className="mb-3">
            <h3 className="text-sm font-semibold text-foreground">新建项目</h3>
            <p className="mt-1 text-xs text-muted-foreground">项目用于归档素材；任务历史归属不会随素材迁移改变。</p>
          </div>
          <div className="flex gap-2">
            <Input
              value={newName}
              maxLength={80}
              placeholder="输入项目名称"
              onChange={(event) => setNewName(event.target.value)}
              onPressEnter={create}
              disabled={busy}
            />
            <Button
              type="primary"
              icon={<Plus className="size-4" />}
              onClick={create}
              loading={busy}
              disabled={!newName.trim()}
            >
              新建
            </Button>
          </div>
        </section>

        {error && (
          <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}

        <section>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground">全部项目</h3>
            <span className="text-xs text-muted-foreground">{projects.length} 个</span>
          </div>
          {projects.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
              还没有项目，先创建一个。
            </div>
          ) : (
            <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
              {projects.map((project) => {
                const editing = editingId === project.id;
                const deleting = deleteTarget?.id === project.id;
                return (
                  <li key={project.id} className="space-y-3 bg-background px-4 py-3">
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="min-w-0 flex-1">
                        {editing ? (
                          <div className="flex max-w-md gap-2">
                            <Input
                              autoFocus
                              value={editingName}
                              maxLength={80}
                              onChange={(event) => setEditingName(event.target.value)}
                              onPressEnter={rename}
                              disabled={busy}
                            />
                            <Button type="primary" size="small" loading={busy} onClick={rename}>保存</Button>
                            <Button type="text" size="small" onClick={() => setEditingId(null)}>取消</Button>
                          </div>
                        ) : (
                          <>
                            <div className="flex items-center gap-2">
                              <span className="truncate text-sm font-medium">{project.name}</span>
                              {currentProjectId === project.id && (
                                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[12px] text-primary">当前</span>
                              )}
                            </div>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {project.assetCount} 个素材 · {project.taskCount} 个任务
                            </p>
                          </>
                        )}
                      </div>
                      {!editing && (
                        <div className="flex shrink-0 items-center gap-1">
                          <Button
                            type="text"
                            size="small"
                            icon={<FolderOpen className="size-3.5" />}
                            onClick={() => {
                              onSelect(project.id);
                              onClose();
                            }}
                          >
                            查看
                          </Button>
                          <Button
                            type="text"
                            size="small"
                            icon={<Pencil className="size-3.5" />}
                            onClick={() => {
                              setDeleteTarget(null);
                              setEditingId(project.id);
                              setEditingName(project.name);
                            }}
                          >
                            重命名
                          </Button>
                          <Button
                            type="text"
                            danger
                            size="small"
                            icon={<Trash2 className="size-3.5" />}
                            onClick={() => {
                              setEditingId(null);
                              setDeleteTarget(project);
                              setMoveTarget(
                                projects.find((candidate) => candidate.id !== project.id)?.id ?? null,
                              );
                            }}
                          >
                            删除
                          </Button>
                        </div>
                      )}
                    </div>

                    {deleting && (
                      <div className="rounded-lg border border-destructive/25 bg-destructive/5 p-3">
                        <p className="text-sm font-medium text-foreground">确认删除「{project.name}」？</p>
                        <p className="mt-1 text-xs leading-5 text-muted-foreground">
                          项目将软删除，素材与文件不会物理删除；{project.taskCount} 个历史任务仍保留原项目归属。
                        </p>
                        {project.assetCount > 0 && (
                          <div className="mt-3 space-y-1.5">
                            <label className="text-xs font-medium text-foreground">
                              将 {project.assetCount} 个素材迁移到
                            </label>
                            <Select
                              value={moveTarget ?? undefined}
                              onChange={(value) => setMoveTarget(String(value))}
                              options={targetOptions}
                              placeholder={targetOptions.length > 0 ? '选择迁移目标项目' : '没有可用的迁移目标项目'}
                              disabled={busy || targetOptions.length === 0}
                              aria-label="素材迁移目标项目"
                              className="w-full"
                            />
                          </div>
                        )}
                        <div className="mt-3 flex justify-end gap-2">
                          <Button type="text" size="small" onClick={() => setDeleteTarget(null)} disabled={busy}>
                            取消
                          </Button>
                          <Button
                            danger
                            size="small"
                            loading={busy}
                            disabled={project.assetCount > 0 && !moveTarget}
                            onClick={remove}
                          >
                            确认删除
                          </Button>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </Modal>
  );
}
