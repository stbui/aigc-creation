import { AlertTriangle, Trash2 } from 'lucide-react';
import type { ReactElement, ReactNode } from 'react';
import { ConfirmAlert } from '~/admin-ui/radar';

/**
 * 用户注销（删除）确认的统一壳 —— 单个删除与批量删除共用。
 *
 * 两个调用方此前各手写一份 `AlertDialog` 骨架（标题图标、影响面滚动区、
 * footer 按钮、加载锁、矮视口限高），改一处漏一处就会出现「同一类高危动作
 * 两种确认形态」。放在 `components/admin` 而不是任一页面目录：单个删除住在
 * `pages/admin/users`，批量删除还要被积分账本页复用，页面目录会造成反向依赖。
 *
 * 这里只固定交互契约，不碰业务口径：
 * - `testId` 由调用方给，e2e 的 `admin-delete-dialog` / `admin-batch-delete-dialog`
 *   钩子不能改名；
 * - `loading` 期间不响应遮罩/ESC 关闭，确认按钮也不自动收起弹框 —— 请求结束
 *   后由父级清空 target 才关闭，避免加载态闪退；
 * - `confirmDisabled` 交给调用方（影响面未加载 / 超过单次上限）。
 *
 * 视觉层由 `ConfirmAlert` 统一：12px 圆角、1px 细线、零阴影、15px 标题。
 */
export function DeleteUsersConfirmDialog({
  testId,
  title,
  description,
  children,
  confirmText,
  loading = false,
  confirmDisabled = false,
  onCancel,
  onConfirm,
}: {
  testId: string;
  title: ReactNode;
  /** `AlertDialogDescription` 用 asChild，必须是单个元素 */
  description: ReactElement;
  /** 影响面区域：由调用方各自组装，壳只负责限高与滚动 */
  children: ReactNode;
  confirmText: string;
  loading?: boolean;
  confirmDisabled?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <ConfirmAlert
      testId={testId}
      title={title}
      description={description}
      icon={AlertTriangle}
      confirmIcon={Trash2}
      body={children}
      bodyScroll
      confirmText={confirmText}
      loading={loading}
      confirmDisabled={confirmDisabled}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}
