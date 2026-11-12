import { useEffect, useRef, useState } from 'react';

/**
 * 元素接近视口时返回 `true` —— 素材卡片据此延迟挂载图片 / 视频。
 *
 * 浏览器原生 `loading="lazy"` 的预载距离很宽（Chrome 约 3000px），一屏 50 张
 * 瀑布流会一次性全部解码，滚动反而没有「随滚随出」的层次；素材量大时首屏
 * 还会和缩略图生成抢资源。这里用 IntersectionObserver 收紧到 600px：
 *
 * - 首屏前 5 张由调用方传 `priority` 直接挂载，不等观察器；
 * - 一旦命中即保持 `true`，回滚时不卸载，避免媒体反复请求；
 * - 不支持 IntersectionObserver 时退化为立即挂载，功能不丢。
 */
export function useNearViewport<T extends Element>(rootMargin = '600px 0px') {
  const ref = useRef<T | null>(null);
  const [near, setNear] = useState(false);

  useEffect(() => {
    if (near) return;
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') {
      setNear(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setNear(true);
          io.disconnect();
        }
      },
      { rootMargin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [near, rootMargin]);

  return [ref, near] as const;
}
