import { useEffect, useMemo, useState } from 'react';
import { FolderOpen, Pencil, Plus, Trash2 } from 'lucide-react';
import { Button, InlineAlert, InlineAlertDescription, Input, Modal, Select, SelectTrigger, SelectValue, SelectContent, SelectGroup, SelectItem, StatusBadge } from './components';
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
              onKeyDown={(e) => { if (e.key === 'Enter') create(); }}
              disabled={busy}
            />
            <Button
              variant="default"
              onClick={create}
              disabled={!newName.trim() || busy}
            >
              <span className="state-spinner is-small" aria-hidden />
              新建
            </Button>
          </div>
        </section>

        {error && (
          <InlineAlert variant="destructive">
            <InlineAlertDescription>{error}</InlineAlertDescription>
          </InlineAlert>
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
                              onKeyDown={(e) => { if (e.key === 'Enter') rename(); }}
                              disabled={busy}
                            />
                            <Button disabled={busy} variant="default" size="sm" onClick={rename}>
                              <span className="state-spinner is-small" aria-hidden />保存</Button>
                            <Button variant="ghost" size="sm" onClick={() => setEditingId(null)}>取消</Button>
                          </div>
                        ) : (
                          <>
                            <div className="flex items-center gap-2">
                              <span className="truncate text-sm font-medium">{project.name}</span>
                              {currentProjectId === project.id && (
                                <StatusBadge variant="secondary">当前</StatusBadge>
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
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              onSelect(project.id);
                              onClose();
                            }}
                          >
                            {<FolderOpen className="size-3.5" />}
                            查看
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setDeleteTarget(null);
                              setEditingId(project.id);
                              setEditingName(project.name);
                            }}
                          >
                            {<Pencil className="size-3.5" />}
                            重命名
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setEditingId(null);
                              setDeleteTarget(project);
                              setMoveTarget(
                                projects.find((candidate) => candidate.id !== project.id)?.id ?? null,
                              );
                            }}
                          >
                            {<Trash2 className="size-3.5" />}
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
                                onValueChange={(value) => setMoveTarget(String(value))}
                                disabled={busy || targetOptions.length === 0}
                              >
                                <SelectTrigger
                                  aria-label={'素材迁移目标项目'}
                                  className={'w-full'}
                                >
                                  <SelectValue placeholder={targetOptions.length > 0 ? '选择迁移目标项目' : '没有可用的迁移目标项目'} />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectGroup>
                                    {targetOptions.map((option) => (
                                      <SelectItem key={String(option.value)} value={String(option.value)}>
                                        {option.label}
                                      </SelectItem>
                                    ))}
                                  </SelectGroup>
                                </SelectContent>
                              </Select>
                          </div>
                        )}
                        <div className="mt-3 flex justify-end gap-2">
                          <Button variant="ghost" size="sm" onClick={() => setDeleteTarget(null)} disabled={busy}>
                            取消
                          </Button>
                          <Button
                            variant="destructive"
                            size="sm"
                            disabled={project.assetCount > 0 && !moveTarget || busy}
                            onClick={remove}
                          >
                            <span className="state-spinner is-small" aria-hidden />
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
