import { useEffect, useRef } from 'react';

/**
 * 卸载时自动 abort 的信号, 用于让进行中的任务轮询停止。
 * 替代各页面手写的 `pollTimers = useRef([]) + 卸载 clearTimeout` 清理样板。
 */
export function usePollAbort(): AbortSignal {
  const ref = useRef<AbortController | null>(null);
  if (!ref.current) ref.current = new AbortController();
  useEffect(() => {
    const controller = ref.current;
    return () => controller?.abort();
  }, []);
  return ref.current.signal;
}
