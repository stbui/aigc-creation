/**
 * AdminNotificationsPage 的 hook 入口 —— 目录内文件的唯一外部 hook 来源。
 */

export {
  useAdmin,
} from '../../../context/AdminContext';

export {
  useDiscardConfirm,
  useUnsavedGuard,
} from '../../../hooks/useUnsavedGuard';

export {
  useToast,
} from '../../../admin-ui/providers/ToastProvider';

export {
  useAdminResource,
} from '../../../admin-ui/primitives';
