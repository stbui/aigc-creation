/** AdminEmailPage 的 hook 入口，页面文件只从这里取共享 hook。 */

export { useAdmin } from '../../../context/AdminContext';
export { useToast } from '../../../admin-ui/providers/ToastProvider';
export { useUnsavedGuard } from '../../../hooks/useUnsavedGuard';
export { useAdminResource } from '../../../admin-ui/primitives';
