import { useEffect, useRef } from 'react';

/**
 * 无限滚动哨兵：元素进入视口（含 400px 预载距离）时回调。
 *
 * 回调经 ref 实时读取，因此调用方可以写 `() => setVisibleCount((v) => ...)`
 * 而不用把最新状态塞进依赖；哨兵节点稳定，观察器只建一次。
 * 不支持 IntersectionObserver 时静默不触发，「加载更多」按钮仍可用。
 */
export function useInfiniteScroll(onReachEnd: () => void, rootMargin = '400px 0px') {
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const callbackRef = useRef(onReachEnd);
  callbackRef.current = onReachEnd;

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) callbackRef.current();
      },
      { rootMargin },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [rootMargin]);

  return sentinelRef;
}
