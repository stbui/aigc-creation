import { useMemo } from 'react';

import { useMediaQuery } from './useMediaQuery';

/**
 * 流水（masonry）布局的列分布。
 *
 * 纯 CSS `column-count` 是列优先填充，视觉顺序会变成「先向下、再向右」，
 * 与阅读习惯相反。这里改用**最短列优先**分配：第一行卡片从左到右铺满，
 * 之后每张落到当前最矮的一列 —— 既保留错落的流水感，阅读顺序也保持
 * 「从左到右、从上到下」，最新内容仍在左上角。
 *
 * 列高只用调用方给的**相对值**（同一列宽下的高/宽比即可）比较，不测量 DOM；
 * 懒加载与滚动追加都不会引起重排。列数与设计断点一致：5 / 4 / 3 / 2 / 1。
 */

const DEFAULT_COLUMNS = 5;

function useColumnCount(): number {
  // hooks 不能写在循环里，四个断点固定订阅
  const isExtraSmall = useMediaQuery('(max-width: 380px)');
  const isSmall = useMediaQuery('(max-width: 640px)');
  const isMedium = useMediaQuery('(max-width: 980px)');
  const isLarge = useMediaQuery('(max-width: 1200px)');
  if (isExtraSmall) return 1;
  if (isSmall) return 2;
  if (isMedium) return 3;
  if (isLarge) return 4;
  return DEFAULT_COLUMNS;
}

/** 缺尺寸时的兜底比例：默认按 3:4（高 / 宽）估高 */
export function mediaHeightRatio(
  width?: number | null,
  height?: number | null,
  fallback = 4 / 3,
): number {
  return width && height ? height / width : fallback;
}

/**
 * 把列表按最短列优先分到各列，返回数组长度即列数。
 *
 * @param items 已按期望顺序排好的项目（通常最新在前）
 * @param estimateHeight 相对高度估算（高 / 宽），用于选择最矮列
 */
export function useMasonryColumns<T>(
  items: T[],
  estimateHeight: (item: T) => number,
): T[][] {
  const columnCount = useColumnCount();

  return useMemo(() => {
    const columns = Array.from({ length: columnCount }, () => [] as T[]);
    const heights = new Array<number>(columnCount).fill(0);
    for (const item of items) {
      // 并列时取最左列，保证第一行严格从左到右
      let target = 0;
      for (let i = 1; i < columnCount; i += 1) {
        if (heights[i] < heights[target]) target = i;
      }
      columns[target].push(item);
      heights[target] += estimateHeight(item);
    }
    return columns;
  }, [items, estimateHeight, columnCount]);
}
