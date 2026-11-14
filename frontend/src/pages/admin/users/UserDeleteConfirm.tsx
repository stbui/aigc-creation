import { useEffect, useState } from 'react';
import { RotateCw } from 'lucide-react';
import { ActionButton, SkeletonBody } from '~/admin-ui/primitives';
import { DeleteUsersConfirmDialog } from '~/components/admin/DeleteUsersConfirmDialog';
import { adminUsersApi } from './api';
import type { AdminUserImpact } from '../../../types/admin-users';
import type { DeleteUserTarget } from './types';

/**
 * 删除（注销）用户的二次确认。
 *
 * 弹框形态交给 `DeleteUsersConfirmDialog`，这里只负责三件事：实时拉影响面、
 * 组装影响面内容、决定何时允许提交。资金记录的留存口径压成一行，确认框不会
 * 比列表还长、把底部按钮挤出矮视口（回归见 `tests/admin.spec.ts`）。
 *
 * 影响面来自 `/admin/users/:id/impact`：加载失败可重试，加载完成前禁止提交，
 * 防止在看不到数据的情况下误删。管理端固定走软注销。
 */
export function UserDeleteConfirm({
  target,
  loading,
  onCancel,
  onConfirm,
}: {
  target: DeleteUserTarget;
  loading: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const [impact, setImpact] = useState<AdminUserImpact | null>(null);
  const [impactError, setImpactError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let alive = true;
    setImpact(null);
    setImpactError(null);
    adminUsersApi
      .impact(target.id)
      .then((result) => {
        if (alive) setImpact(result);
      })
      .catch((error: unknown) => {
        if (alive) {
          setImpactError(error instanceof Error ? error.message : '影响面加载失败');
        }
      });
    return () => {
      alive = false;
    };
  }, [target.id, reloadKey]);

  const retainedTotal = impact
    ? Object.values(impact.retained).reduce((sum, count) => sum + count, 0)
    : 0;

  return (
    <DeleteUsersConfirmDialog
      testId="admin-delete-dialog"
      title="删除用户"
      description={
        <p>
          将注销账号 <strong className="break-all">{target.email}</strong>
          {'：账号立即失效，作品（含存储文件）与积分清除，操作不可撤销。'}
        </p>
      }
      confirmText={loading ? '注销中…' : '确认注销'}
      loading={loading}
      confirmDisabled={impact === null}
      onCancel={onCancel}
      onConfirm={onConfirm}
    >
      {impactError ? (
        <div className="flex items-center gap-2 text-destructive">
          <span className="min-w-0 flex-1">{impactError}</span>
          <ActionButton
            variant="ghost"
            size="sm"
            onClick={() => setReloadKey((value) => value + 1)}
          >
            <RotateCw className="size-3.5" aria-hidden />
            重试
          </ActionButton>
        </div>
      ) : impact === null ? (
        <div aria-live="polite">
          <div className="mb-1.5 text-muted-foreground">正在加载影响面…</div>
          <SkeletonBody rows={2} />
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          <div>
            <span className="font-medium text-destructive">将清除</span>
            <span className="ml-2 text-muted-foreground tabular-nums">
              {`项目 ${impact.projects} · 任务 ${impact.tasks} · 素材 ${impact.assets}`}
            </span>
          </div>
          <div>
            <span className="font-medium">将匿名保留（{retainedTotal} 条）</span>
            <span className="ml-2 text-muted-foreground">资金记录按法务要求留存</span>
          </div>
        </div>
      )}
    </DeleteUsersConfirmDialog>
  );
}
