/**
 * 支付充值的 hook 入口 —— 目录内文件的唯一外部 hook 来源。
 *
 * 约定：`payments/` 下的文件不从 `src/admin-ui/providers` / `src/context` /
 * `src/admin-ui/primitives` 直接取 hook，一律经由本文件 —— 页面用到的外部 hook
 * 集中可见，换实现或加埋点只改一处。目录内新增外部 hook 引用时在这里补一行
 * re-export。
 */

export { useToast } from '../../../admin-ui/providers/ToastProvider';
export { useAdmin } from '../../../context/AdminContext';
export {
  useAdminDetailParam,
  useAdminList,
  useAdminResource,
  useAdminUrlFilterSync,
} from '../../../admin-ui/primitives';
