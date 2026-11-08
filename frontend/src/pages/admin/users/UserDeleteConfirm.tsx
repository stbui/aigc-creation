import { useEffect, useState } from 'react';
import { AlertTriangle, RotateCw } from 'lucide-react';
import {
  ActionButton,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  SkeletonBody,
} from '~/admin-ui/primitives';
import { adminUsersApi } from './api';
import type { AdminUserImpact } from '../../../types/admin-users';
import type { AdminUserRow } from './types';

/**
 * 删除（注销）用户的二次确认。
 *
 * 管理端固定走软注销：后端使用与 C 端自助注销相同的生命周期实现。确认前
 * 必须展示将清除的作品数据和依法保留的资金记录，避免把「删除」误解成物理
 * 抹除，也避免运营在看不到影响面的情况下误操作。
 */
export function UserDeleteConfirm({
  target,
  loading,
  onCancel,
  onConfirm,
}: {
  target: AdminUserRow;
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
    <AlertDialog
      open
      onOpenChange={(next) => {
        if (!next && !loading) onCancel();
      }}
    >
      <AlertDialogContent
        data-testid="admin-delete-dialog"
        className="admin-portal max-h-[calc(100vh-2rem)] w-[calc(100%-2rem)] max-w-[440px] gap-0 overflow-hidden p-0"
      >
        <AlertDialogHeader className="px-5 py-4 text-left">
          <AlertDialogTitle className="flex items-center gap-2 text-base text-destructive">
            <AlertTriangle className="size-4 shrink-0" aria-hidden />
            删除用户
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="flex flex-col gap-1.5">
              <p>
                将注销账号 <strong>{target.email}</strong>。注销后该账号立即失效。
              </p>
              <p>作品、任务、素材与积分会被清除；资金记录将按法务要求匿名保留。</p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="min-h-0 overflow-y-auto border-y border-border bg-muted/30 px-5 py-4">
          {impactError ? (
            <div className="flex items-start gap-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-xs">
              <span className="min-w-0 flex-1 text-destructive">{impactError}</span>
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
              <div className="mb-2 text-xs text-muted-foreground">正在加载影响面…</div>
              <SkeletonBody rows={2} />
            </div>
          ) : (
            <div className="flex flex-col gap-3 text-xs">
              <ImpactGroup
                label="将清除"
                detail={`项目 ${impact.projects} · 任务 ${impact.tasks} · 素材 ${impact.assets}`}
                emphasis
              />
              <ImpactGroup
                label={`将匿名保留（${retainedTotal} 条）`}
                detail={`订单 ${impact.retained.orders} · 支付 ${impact.retained.payments} · 退款 ${impact.retained.refunds} · 发票 ${impact.retained.invoices} · 生成账单 ${impact.retained.billingOrders} · 积分流水 ${impact.retained.creditLedgerEntries}`}
              />
              <p className="text-muted-foreground">
                对象存储中的作品文件会同步删除，操作不可撤销。
              </p>
            </div>
          )}
        </div>

        <AlertDialogFooter className="bg-muted/40 px-5 py-3">
          <AlertDialogCancel size="sm" disabled={loading} onClick={onCancel}>
            取消
          </AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            size="sm"
            disabled={loading || impact === null}
            onClick={(event) => {
              // 请求结束后再由父级关闭，避免加载期间弹框提前消失。
              event.preventDefault();
              onConfirm();
            }}
          >
            {loading ? '注销中…' : '确认注销'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function ImpactGroup({
  label,
  detail,
  emphasis = false,
}: {
  label: string;
  detail: string;
  emphasis?: boolean;
}) {
  return (
    <div className="rounded-md border border-border bg-background/70 px-3 py-2">
      <div className={emphasis ? 'font-medium text-destructive' : 'font-medium'}>
        {label}
      </div>
      <div className="mt-1 leading-5 text-muted-foreground tabular-nums">{detail}</div>
    </div>
  );
}
