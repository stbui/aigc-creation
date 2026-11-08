/**
 * 后台 CSV 导出动作的统一编排。
 *
 * 页面各自写 `setExporting(true) → try → toast → finally` 已经出现七份逐字重复，
 * 收口后「单飞保护 / 错误提示 / 导出中文案」只改一处。三件事：
 *   1. 单飞锁 —— 导出进行中的重复点击直接忽略，不再并发打多次导出请求；
 *   2. `exporting` —— 供按钮 `disabled` 与「导出中…」文案使用；
 *   3. 错误 toast —— 统一 `e.message` 与「导出失败」兜底。
 *
 * toast 由调用方传入（页面本来已持有 `useToast()`），避免再挂一次 context；
 * 成功文案由调用方决定：多数页面提示「导出已开始下载」，筛选 hook 静默。
 * 导出参数仍由各页按自己的筛选口径组装，本 hook 不碰查询条件。
 */
import { useCallback, useRef, useState } from 'react';
import type { ToastApi } from '../providers/ToastProvider';

type ExportToast = Pick<ToastApi, 'success' | 'error'>;

export function useAdminExport(toast: ExportToast) {
  const [exporting, setExporting] = useState(false);
  const busyRef = useRef(false);

  const runExport = useCallback(
    async (download: () => Promise<unknown>, successMessage?: string): Promise<void> => {
      if (busyRef.current) return;
      busyRef.current = true;
      setExporting(true);
      try {
        await download();
        if (successMessage) toast.success(successMessage);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : '导出失败');
      } finally {
        busyRef.current = false;
        setExporting(false);
      }
    },
    [toast],
  );

  return { exporting, runExport };
}
