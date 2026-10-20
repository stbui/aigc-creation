import { useEffect, useRef } from 'react';

/**
 * 卸载时自动 abort 的信号, 用于让进行中的任务轮询停止。
 * 替代各页面手写的 `pollTimers = useRef([]) + 卸载 clearTimeout` 清理样板。
 *
 * 2026-10-20 修复 P0：StrictMode 下本页「永久生成中」。
 *   React 18+ 开发模式会**同步重放**一次 effect（mount → cleanup → mount），
 *   用来暴露副作用缺失清理。此前本 hook 在 cleanup 里直接 `controller.abort()`，
 *   于是首轮假卸载把 controller 打死，而 ref 仍指向它 —— 第二次挂载拿到的
 *   `signal.aborted` 恒为 true。轮询层（lib/poll.ts）第一行就判定「已中止」并返回
 *   永不 resolve 的 PENDING promise，于是：
 *     - 轮询请求一次都不发（网络面板只有 POST /generate，无 GET /tasks/:id）
 *     - `submitting` 永不复位，按钮卡在「生成中…」
 *   影响面是全部 7 个消费方（free-creation / product-kit / product-detail /
 *   viral-clone / multi-fusion / product-sku / ToolShell 修图系）。
 *
 * 修法：cleanup 里**延迟一拍**再 abort，重挂载时把这次 abort 撤掉。
 *   - StrictMode 假卸载 → 重挂载是同步的，effect 体首行 clearTimeout 撤掉 abort，
 *     controller 存活，轮询正常。
 *   - 真卸载 → 组件已不在，延迟 0ms 的 abort 照常执行，语义与修复前完全一致。
 */
export function usePollAbort(): AbortSignal {
  const ref = useRef<AbortController | null>(null);
  const abortTimer = useRef<number | null>(null);
  if (!ref.current) ref.current = new AbortController();

  useEffect(() => {
    // 重挂载（StrictMode 假卸载后的第二次挂载）→ 撤销上一次 cleanup 排队的 abort
    if (abortTimer.current !== null) {
      window.clearTimeout(abortTimer.current);
      abortTimer.current = null;
    }
    const controller = ref.current;
    return () => {
      abortTimer.current = window.setTimeout(() => {
        abortTimer.current = null;
        controller?.abort();
      }, 0);
    };
  }, []);

  return ref.current.signal;
}
