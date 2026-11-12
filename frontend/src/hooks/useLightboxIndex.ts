import { useEffect, useMemo, useState } from 'react';

/**
 * 大图查看器的下标状态。
 *
 * 两个 C 端列表页（我的作品 / 素材库）共用同一套语义：列表变化后当前下标可能
 * 越界，收敛到最近一张；列表为空则关闭。`indexById` 让卡片渲染时 O(1) 拿到
 * 自己在查看器里的位置，不必逐卡 findIndex。
 */
export function useLightboxIndex<T extends { id: string }>(items: T[]) {
  const [index, setIndex] = useState<number | null>(null);

  const indexById = useMemo(
    () => new Map(items.map((item, itemIndex) => [item.id, itemIndex])),
    [items],
  );

  useEffect(() => {
    setIndex((prev) => {
      if (prev === null) return null;
      if (prev < items.length) return prev;
      return items.length > 0 ? items.length - 1 : null;
    });
  }, [items.length]);

  return { index, setIndex, indexById };
}
