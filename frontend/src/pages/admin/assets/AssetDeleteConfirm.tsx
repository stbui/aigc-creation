import { useEffect, useState } from 'react';
import { ActionButton, ConfirmAction, SkeletonBody } from '~/admin-ui/primitives';
import { adminAssetsApi } from './api';
import { BACKEND_LABEL, type AssetDeleteTarget } from './constants';
import { assetLabel, fmtBytes } from './utils';

interface Impact {
  sizeBytes: number;
  tasks: number;
  storageBackend: string;
}

/**
 * 素材删除的二次确认。
 *
 * 原实现点「删除」直接执行。单张删除先拉 `/admin/assets/:id/impact` 展示
 * 文件大小与关联任务数 —— 用户能据此判断删掉的是不是那张大图；批量删除只
 * 展示条数，不为 N 张各发一次请求。
 */
export function AssetDeleteConfirm({
  target,
  loading,
  onCancel,
  onConfirm,
}: {
  target: AssetDeleteTarget;
  loading: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const [impact, setImpact] = useState<Impact | null>(null);
  const [impactError, setImpactError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const singleId = target.kind === 'single' ? target.row.id : null;

  useEffect(() => {
    if (!singleId) return;
    let alive = true;
    setImpact(null);
    setImpactError(null);
    adminAssetsApi
      .impact(singleId)
      .then((res) => {
        if (alive) setImpact(res);
      })
      .catch((e: unknown) => {
        if (alive) setImpactError(e instanceof Error ? e.message : '删除影响加载失败');
      });
    return () => {
      alive = false;
    };
  }, [singleId, reloadKey]);

  return (
    <ConfirmAction
      open
      title={target.kind === 'single' ? '删除素材' : `批量删除 ${target.count} 张素材`}
      confirmText={target.kind === 'single' ? '确认删除' : '确认批量删除'}
      danger
      loading={loading}
      onCancel={onCancel}
      onConfirm={onConfirm}
      description={
        target.kind === 'single' ? (
          <>
            <p>
              素材：<strong>{assetLabel(target.row)}</strong>
            </p>
            <p className="mt-1 text-danger-text">
              删除会同时移除对象存储文件，且无法恢复；需要暂时隐藏请改用「下架」。
            </p>
          </>
        ) : (
          <p className="text-danger-text">
            将永久删除当前选中的 {target.count} 张素材及其对象存储文件，无法恢复。
            需要暂时隐藏请改用「批量下架」。
          </p>
        )
      }
      impact={[
        '对象存储文件同步删除，不可恢复',
        '引用该素材的任务记录会被连带清理',
        '用户端素材库立即不可见',
        '写操作审计（含操作人）',
      ]}
      extra={
        target.kind === 'single' ? (
          <div className="rounded-lg border border-border px-3 py-2">
            <div className="text-[12px] text-muted-foreground">将删除的数据</div>
            {impactError ? (
              <div className="mt-1 flex items-center gap-2 text-xs text-danger-text">
                <span className="min-w-0 flex-1">{impactError}</span>
                <ActionButton
                  variant="ghost"
                  size="sm"
                  onClick={() => setReloadKey((n) => n + 1)}
                >
                  重试
                </ActionButton>
              </div>
            ) : impact === null ? (
              <div className="mt-1.5">
                <SkeletonBody rows={2} />
              </div>
            ) : (
              <div className="mt-1 flex flex-wrap gap-x-5 gap-y-1 text-xs text-foreground tabular-nums">
                <span>{fmtBytes(impact.sizeBytes)}</span>
                <span>关联任务 {impact.tasks}</span>
                <span>{BACKEND_LABEL[impact.storageBackend] ?? impact.storageBackend}</span>
                <span className="text-muted-foreground">
                  {target.row.ownerEmail} · {target.row.projectName}
                </span>
              </div>
            )}
          </div>
        ) : undefined
      }
    />
  );
}
