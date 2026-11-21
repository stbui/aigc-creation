/**
 * 系统设置的 hook 入口 —— 目录内文件的唯一外部 hook 来源。
 * 需要新的外部 hook / provider 时先在这里补一行 re-export。
 */

export { useToast } from '../../../admin-ui/providers/ToastProvider';
export { useAdmin } from '../../../context/AdminContext';
export { useUnsavedGuard } from '~/admin-ui/radar';
export { useAdminResource } from '~/admin-ui/radar';
