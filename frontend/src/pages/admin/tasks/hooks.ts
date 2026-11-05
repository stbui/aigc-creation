/**
 * 任务监控的 hook 入口 —— 目录内文件的唯一外部 hook 来源。
 *
 * `useDuty` 来自值班上下文（30 秒轮询、页面不可见时暂停），本页只读拥堵读数。
 */

export { useToast } from '../../../admin-ui/providers/ToastProvider';
export { useAdmin } from '../../../context/AdminContext';
export { useDuty } from '../../../components/admin/DutyContext';
export {
  useAdminDetailParam,
  useAdminList,
  useAdminResource,
  useAdminUrlFilterSync,
} from '../../../admin-ui/primitives';
