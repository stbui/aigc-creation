import { useEffect, useState } from 'react';
import { ConfirmDialog, Notice, SelectField, TextField } from '~/admin-ui/primitives';
import { adminAssetsApi } from './api';
import type { AdminProject } from '../../../types/api';

export interface ProjectDeleteResult {
  id: string;
  hard: boolean;
  deprecatedHard: true;
  deletedAt: string;
  movedAssets: number;
  retained: { assets: number; tasks: number };
}

interface ProjectDeleteConfirmProps {
  target: AdminProject;
  onCancel: () => void;
  onDeleted: (result: ProjectDeleteResult) => void;
}

/** 删除项目：有素材时必须选择同一用户的迁移目标，任务历史始终保留。 */
export function ProjectDeleteConfirm({ target, onCancel, onDeleted }: ProjectDeleteConfirmProps) {
  const [keyword, setKeyword] = useState('');
  const [candidates, setCandidates] = useState<AdminProject[]>([]);
  const [moveTarget, setMoveTarget] = useState('');
  const [loading, setLoading] = useState(target.assetCount > 0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setKeyword('');
    setCandidates([]);
    setMoveTarget('');
    setError(null);
  }, [target.id]);

  useEffect(() => {
    if (target.assetCount === 0) {
      setLoading(false);
      return;
    }
    let alive = true;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError(null);
      void adminAssetsApi
        .listProjects({
          ownerId: target.ownerId,
          keyword: keyword.trim() || undefined,
          page: 1,
          pageSize: 100,
        })
        .then((result) => {
          if (!alive) return;
          const next = result.items.filter((project) => project.id !== target.id);
          setCandidates(next);
          setMoveTarget((current) =>
            current && next.some((project) => project.id === current) ? current : (next[0]?.id ?? ''),
          );
        })
        .catch((caught: unknown) => {
          if (!alive) return;
          setCandidates([]);
          setMoveTarget('');
          setError(caught instanceof Error ? caught.message : '迁移目标项目加载失败');
        })
        .finally(() => {
          if (alive) setLoading(false);
        });
    }, 200);

    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [keyword, target.assetCount, target.id, target.ownerId]);

  const needsMove = target.assetCount > 0;
  const confirmDisabled = needsMove && !moveTarget;

  const remove = async () => {
    if (confirmDisabled || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await adminAssetsApi.removeProject(target.id, moveTarget || undefined);
      onDeleted(result);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '删除项目失败，请重试');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ConfirmDialog
      open
      title={`删除项目「${target.name}」？`}
      description="项目执行软删除，素材、任务和对象存储文件都不会被物理删除。"
      impact={[
        needsMove
          ? `${target.assetCount} 个素材将迁移到所选目标项目`
          : '当前项目没有素材，无需迁移',
        `${target.taskCount} 个历史任务保留原项目归属，不会随素材迁移`,
        `所属用户：${target.ownerEmail}`,
      ]}
      danger
      loading={submitting}
      confirmDisabled={confirmDisabled || loading}
      confirmText="删除项目"
      onCancel={onCancel}
      onConfirm={() => void remove()}
      extra={
        needsMove ? (
          <div className="space-y-3">
            <div className="rounded-lg border border-warn-soft bg-warn-soft/60 px-3 py-2 text-xs leading-5 text-warn-text">
              有素材的项目不能直接删除，请选择一个同用户的未删除项目接收素材。
            </div>
            <TextField
              ariaLabel="搜索迁移目标项目"
              value={keyword}
              placeholder="搜索目标项目名称"
              disabled={submitting}
              onChange={setKeyword}
            />
            {error && <Notice tone="danger">{error}</Notice>}
            <SelectField
              ariaLabel="迁移目标项目"
              value={moveTarget || undefined}
              onChange={(value) => setMoveTarget(value ?? '')}
              options={candidates.map((project) => ({
                value: project.id,
                label: `${project.name}（${project.assetCount} 个素材）`,
              }))}
              placeholder={
                loading
                  ? '正在加载可用项目…'
                  : candidates.length > 0
                    ? '请选择迁移目标项目'
                    : '没有可用的迁移目标项目'
              }
              disabled={submitting || loading || candidates.length === 0}
            />
            {!loading && candidates.length === 0 && (
              <p className="text-xs text-danger-text">
                请先为该用户新建另一个项目，再回来删除当前项目。
              </p>
            )}
          </div>
        ) : error ? (
          <Notice tone="danger">{error}</Notice>
        ) : undefined
      }
    />
  );
}
