/**
 * 订单管理的 hook 入口 —— 目录内文件的唯一外部 hook 来源。
 */

export { useToast } from '../../../admin-ui/providers/ToastProvider';
export { useAdmin } from '../../../context/AdminContext';
export {
  useAdminDetailParam,
  useAdminList,
  useAdminUrlFilterSync,
  useSelectionPrune,
} from '../../../admin-ui/primitives';
