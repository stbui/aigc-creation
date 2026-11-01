import { describe, expect, it } from 'vitest';
import { moveOrderItem, orderChanged } from '../channelOrder';

/**
 * 排序的纯函数。
 *
 * 锁住三条不变量：
 *   1. 越界 / 找不到 / 原地不动都返回**原数组引用**（调用方直接塞进 state，
 *      不需要额外判断；返回新数组会让 React 白渲染一次）；
 *   2. 移动后其余元素的相对顺序不变（这是「移动」而不是「重排」）；
 *   3. `orderChanged` 逐项比对 id 序列 —— 只比长度会把「换位」漏掉。
 */

const items = [
  { id: 'a', name: 'A', enabled: true },
  { id: 'b', name: 'B', enabled: false },
  { id: 'c', name: 'C', enabled: true },
];

describe('moveOrderItem', () => {
  it('把条目移到指定位置', () => {
    expect(moveOrderItem(items, 'c', 0).map((item) => item.id)).toEqual(['c', 'a', 'b']);
    expect(moveOrderItem(items, 'a', 2).map((item) => item.id)).toEqual(['b', 'c', 'a']);
  });

  it('下移一位', () => {
    expect(moveOrderItem(items, 'a', 1).map((item) => item.id)).toEqual(['b', 'a', 'c']);
  });

  it('原地不动时返回原数组引用', () => {
    expect(moveOrderItem(items, 'a', 0)).toBe(items);
  });

  it('越界与不存在的 id 返回原数组引用', () => {
    expect(moveOrderItem(items, 'a', -1)).toBe(items);
    expect(moveOrderItem(items, 'a', 3)).toBe(items);
    expect(moveOrderItem(items, 'zz', 0)).toBe(items);
  });

  it('不修改原数组', () => {
    moveOrderItem(items, 'c', 0);
    expect(items.map((item) => item.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('orderChanged', () => {
  it('顺序一致时为 false', () => {
    expect(orderChanged(items, ['a', 'b', 'c'])).toBe(false);
  });

  it('换位即为 true（长度不变也算改过）', () => {
    expect(orderChanged(items, ['b', 'a', 'c'])).toBe(true);
  });

  it('长度不同即为 true', () => {
    expect(orderChanged(items, ['a', 'b'])).toBe(true);
  });
});
