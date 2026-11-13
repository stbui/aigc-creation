/** AdminPaymentRulesPage 的 hook 入口 —— 目录内文件只从这里取共享 hook。 */

export { useAdmin } from '../../../context/AdminContext';
export { useToast } from '../../../admin-ui/providers/ToastProvider';
export { useUnsavedGuard } from '../../../hooks/useUnsavedGuard';
export { useAdminResource } from '../../../admin-ui/primitives';
