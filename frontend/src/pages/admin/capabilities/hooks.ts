/**
 * 能力管理的 hook 入口 —— 目录内文件的唯一外部 hook 来源。
 *
 * 约定：`capabilities/` 下的文件不从 `src/admin-ui/providers` / `src/context`
 * 直接取 hook，一律经由本文件。页面用到的外部 hook 集中可见，换实现或加埋点
 * 只改一处；目录内新增外部 hook 引用时在这里补一行 re-export。
 */

export { useAdmin } from '../../../context/AdminContext';
export { useConfirm } from '~/admin-ui/providers/ConfirmProvider';
export { useToast } from '~/admin-ui/providers/ToastProvider';

export { useAdminResource, useAdminUrlFilterSync } from '~/admin-ui/radar';
export { ConfirmProvider } from '~/admin-ui/providers/ConfirmProvider';
export { ToastProvider } from '~/admin-ui/providers/ToastProvider';