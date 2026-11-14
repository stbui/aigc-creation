import { AlertTriangle } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '~/admin-ui/primitives';

/**
 * 批量注销（删除）用户的确认弹框 —— 用户管理页与积分账本页共用。
 *
 * 放在 `components/admin` 而不是任一页面目录：两处删的是同一种对象、走同一个
 * 接口（`POST /admin/users/batch` 的 `action=delete`），复制一份就会出现
 * 「一边改了口径、另一边没有」的分叉。
 *
 * ## 确认方式
 *
 * 弹框把不可逆性摊开在明面上（将清除 / 将匿名保留 / 目标账号清单与数量），
 * 运营只需点「确认删除」，不再要求手工键入确认词 —— 与后台高危操作确认的
 * 统一口径一致（见 `docs/admin-detailed-design.md` 0.6）。
 * 服务端仍校验约定的 `confirm` 值，由调用方固定传入，防止绕过界面直接调接口。
 */

/** 服务端约定的确认词（调用方固定传入）与批量删除单次上限 */
export const BATCH_DELETE_CONFIRM = '删除';
export const BATCH_DELETE_LIMIT = 20;

/** 弹框里逐个列出邮箱的上限；超出部分只给数量，避免弹框被名单撑爆 */
const MAX_LISTED = 8;

/**
 * 删除目标的最小形状。
 *
 * 计数是可选的：用户管理页的列表行带项目/任务/素材数，积分账本页的行没有
 * （它的行是积分账户，不是用户档案），此时由调用方给 `clearedNote` 说明
 * 「这次删掉的是什么」。
 */
export interface BatchDeleteTarget {
  id: string;
  email: string;
  projectCount?: number;
  taskCount?: number;
  assetCount?: number;
}

export function BatchDeleteUsersDialog({
  targets,
  clearedNote,
  loading,
  onCancel,
  onConfirm,
}: {
  targets: BatchDeleteTarget[];
  /** 没有计数时展示的「将清除」说明 */
  clearedNote?: string;
  loading: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const hasCounts = targets.some(
    (target) => target.projectCount !== undefined && target.assetCount !== undefined,
  );
  const cleared = targets.reduce(
    (sum, target) => ({
      projects: sum.projects + (target.projectCount ?? 0),
      tasks: sum.tasks + (target.taskCount ?? 0),
      assets: sum.assets + (target.assetCount ?? 0),
    }),
    { projects: 0, tasks: 0, assets: 0 },
  );

  const overLimit = targets.length > BATCH_DELETE_LIMIT;
  const listed = targets.slice(0, MAX_LISTED);
  const rest = targets.length - listed.length;

  return (
    <AlertDialog
      open
      onOpenChange={(next) => {
        if (!next && !loading) onCancel();
      }}
    >
      <AlertDialogContent
        data-testid="admin-batch-delete-dialog"
        className="admin-portal max-h-[calc(100vh-2rem)] w-[calc(100%-2rem)] max-w-[440px] gap-0 overflow-hidden p-0"
      >
        <AlertDialogHeader className="px-5 py-4 text-left">
          <AlertDialogTitle className="flex items-center gap-2 text-base text-destructive">
            <AlertTriangle className="size-4 shrink-0" aria-hidden />
            删除 {targets.length} 个用户
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="flex flex-col gap-1.5">
              <p>将以「注销」方式删除这些账号：账号立即失效，作品与积分清零并匿名化。</p>
              <p>该操作不可撤销，资金记录将按法务要求匿名保留。</p>
              <p>共 {targets.length} 个账号，提交后逐条返回结果。</p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="min-h-0 overflow-y-auto border-y border-border bg-muted/30 px-5 py-4">
          <div className="flex flex-col gap-3 text-xs">
            <div className="rounded-md border border-border bg-background/70 px-3 py-2">
              <div className="font-medium text-destructive">将清除</div>
              <div className="mt-1 leading-5 text-muted-foreground tabular-nums">
                {hasCounts
                  ? `项目 ${cleared.projects} · 任务 ${cleared.tasks} · 素材 ${cleared.assets}`
                  : (clearedNote ?? '作品、任务、素材与全部积分批次')}
              </div>
            </div>

            <div className="rounded-md border border-border bg-background/70 px-3 py-2">
              <div className="font-medium">将匿名保留</div>
              <div className="mt-1 leading-5 text-muted-foreground">
                订单、支付、退款、发票、生成账单与积分流水按法务要求留存，只解绑到匿名账号。
              </div>
            </div>

            <div>
              <div className="font-medium text-foreground">目标账号</div>
              <ul className="mt-1 flex flex-col gap-0.5 text-muted-foreground">
                {listed.map((target) => (
                  <li key={target.id} className="truncate" title={target.email}>
                    {target.email}
                  </li>
                ))}
              </ul>
              {rest > 0 && (
                <div className="mt-1 text-muted-foreground">
                  另有 {rest} 个账号未列出，共 {targets.length} 个
                </div>
              )}
            </div>

            {overLimit && (
              <p className="text-destructive">
                单次最多删除 {BATCH_DELETE_LIMIT} 个账号，当前选了 {targets.length} 个。请分批处理。
              </p>
            )}
          </div>
        </div>

        <AlertDialogFooter className="bg-muted/40 px-5 py-3">
          <AlertDialogCancel size="sm" disabled={loading} onClick={onCancel}>
            取消
          </AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            size="sm"
            disabled={loading || overLimit}
            onClick={(event) => {
              // 请求结束后再由父级关闭，避免加载期间弹框提前消失。
              event.preventDefault();
              onConfirm();
            }}
          >
            {loading ? '删除中…' : `确认删除 ${targets.length} 个`}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
