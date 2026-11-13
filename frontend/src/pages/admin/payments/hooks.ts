import { useEffect, useRef } from 'react';

/**
 * 支付配置的 hook 入口 —— 目录内文件的唯一外部 hook 来源。
 *
 * 约定：`payments/` 下的文件不从 `src/admin-ui/providers` / `src/context` /
 * `src/admin-ui/primitives` 直接取 hook，一律经由本文件 —— 页面用到的外部 hook
 * 集中可见，换实现或加埋点只改一处。目录内新增外部 hook 引用时在这里补一行
 * re-export；本目录自有的取数 hook 按域拆在 `usePayment*Filters.ts` 里，同样
 * 从这里转出。
 */

export { useToast } from '../../../admin-ui/providers/ToastProvider';
export { useAdmin } from '../../../context/AdminContext';
export {
  useAdminDetailParam,
  useAdminExport,
  useAdminList,
  useAdminResource,
  useAdminUrlFilterSync,
} from '../../../admin-ui/primitives';
export { useDiscardConfirm, useUnsavedGuard } from '../../../hooks/useUnsavedGuard';

export { usePaymentExceptionFilters } from './usePaymentExceptionFilters';
export { useReconciliationFilters } from './useReconciliationFilters';

/**
 * 页面级「刷新当前标签」。
 *
 * 各标签原本各写一段 `useEffect(() => { if (nonce > 0) reload() })`：既重复，
 * 又会在「先点刷新、再切到另一个标签」时于挂载后多打一次请求（列表 hook 挂载
 * 本身已经取过数）。这里记住挂载时的 nonce，只在它真正变化时重取。
 */
export function useRefreshOnNonce(
  nonce: number,
  ...reloads: Array<() => void | Promise<unknown>>
) {
  const seen = useRef(nonce);
  const reloadsRef = useRef(reloads);
  reloadsRef.current = reloads;

  useEffect(() => {
    if (nonce === seen.current) return;
    seen.current = nonce;
    for (const reload of reloadsRef.current) void reload();
  }, [nonce]);
}
