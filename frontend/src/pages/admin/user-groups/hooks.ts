/**
 * 用户分组的 hook 入口 —— 目录内文件的唯一外部 hook 来源。
 */

export { useAdminResource } from '~/admin-ui/radar';
export { useAdmin } from '../../../context/AdminContext';
export { useToast } from '../../../admin-ui/providers/ToastProvider';
export { useDiscardConfirm, useUnsavedGuard } from '~/admin-ui/hooks/useUnsavedGuard';
