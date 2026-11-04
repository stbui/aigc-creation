import { useCallback } from 'react';
import { usePollAbort } from './usePollAbort';
import { pollToResult } from '../lib/poll';

/**
 * 任务轮询工具：各工具页提交后复用。
 *
 * 薄封装 —— 轮询协议、取消语义与结果映射统一在 `lib/poll.ts`，本 hook 只负责
 * 把当前页面的 abort signal 绑进去。2026-11-04 从 `components/ToolShell.tsx`
 * 移入 hooks 目录（它此前是唯一混在组件文件里的 hook）。
 */
export function useTaskPoller() {
  const signal = usePollAbort();
  return useCallback((taskId: string) => pollToResult(taskId, { signal }), [signal]);
}
