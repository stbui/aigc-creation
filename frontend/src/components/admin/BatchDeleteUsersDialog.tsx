import { DeleteUsersConfirmDialog } from './DeleteUsersConfirmDialog';

/**
 * 批量注销（删除）用户的确认内容 —— 用户管理页与积分账本页共用。
 *
 * 放在 `components/admin` 而不是任一页面目录：两处删的是同一种对象、走同一个
 * 接口（`POST /admin/users/batch` 的 `action=delete`），复制一份就会出现
 * 「一边改了口径、另一边没有」的分叉。弹框形态统一由
 * `DeleteUsersConfirmDialog` 提供，这里只负责聚合影响量与目标清单。
 *
 * ## 确认方式
 *
 * 按 `docs/admin-detailed-design.md` 0.6：写明影响量、不要求键入确认词、不要求
 * 填写业务原因。数量已在标题与按钮各出现一次，正文不再重复；账号清单只给前
 * 几个示例，完整名单放在 `title` 里供核查。服务端仍校验约定的 `confirm` 值，
 * 由调用方固定传入，防止绕过界面直接调接口。
 */

/** 服务端约定的确认词（调用方固定传入）与批量删除单次上限 */
export const BATCH_DELETE_CONFIRM = '删除';
export const BATCH_DELETE_LIMIT = 20;

/** 弹框里列出邮箱示例的个数；完整名单放进 title，避免弹框被名单撑爆 */
const MAX_LISTED = 3;

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
  const allEmails = targets.map((target) => target.email).join('、');

  return (
    <DeleteUsersConfirmDialog
      testId="admin-batch-delete-dialog"
      title={`删除 ${targets.length} 个用户`}
      description={
        <p>将以「注销」方式删除选中账号：立即失效，作品与积分清零，操作不可撤销。</p>
      }
      confirmText={loading ? '删除中…' : `确认删除 ${targets.length} 个`}
      loading={loading}
      confirmDisabled={overLimit}
      onCancel={onCancel}
      onConfirm={onConfirm}
    >
      <div className="flex flex-col gap-1.5">
        <div>
          <span className="font-medium text-destructive">将清除</span>
          <span className="ml-2 text-muted-foreground tabular-nums">
            {hasCounts
              ? `项目 ${cleared.projects} · 任务 ${cleared.tasks} · 素材 ${cleared.assets}`
              : (clearedNote ?? '作品、任务、素材与全部积分批次')}
          </span>
        </div>
        <div className="text-muted-foreground">资金记录按法务要求匿名保留</div>
        <div className="truncate text-muted-foreground" title={allEmails}>
          目标账号：{listed.map((target) => target.email).join('、')}
          {rest > 0 && ` 等 ${targets.length} 个`}
        </div>
        {overLimit && (
          <p className="text-destructive">
            单次最多删除 {BATCH_DELETE_LIMIT} 个账号，请分批处理。
          </p>
        )}
      </div>
    </DeleteUsersConfirmDialog>
  );
}
