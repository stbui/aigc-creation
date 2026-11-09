import { useEffect, type Dispatch, type SetStateAction } from 'react';

/**
 * 让勾选只对当前屏幕上的行有效。
 *
 * 翻页、换筛选或刷新后，上一屏勾选的 id 已经不在列表里；继续留在 `selected`
 * 里，批量动作会作用到用户看不见的行，界面上的「已选 N 条」也与屏幕对不上。
 * 列表数据落定后把选中裁剪到 `visibleIds`，保持引用不变则不触发重渲染。
 *
 * 页面仍应自己决定「哪些行可选」：本 hook 只保证选中的 id 在可见集合内，
 * 不判断业务上能否批量操作。
 */
export function useSelectionPrune(
  setSelected: Dispatch<SetStateAction<string[]>>,
  visibleIds: readonly string[],
) {
  useEffect(() => {
    const visible = new Set(visibleIds);
    setSelected((current) => {
      const next = current.filter((id) => visible.has(id));
      return next.length === current.length ? current : next;
    });
  }, [setSelected, visibleIds]);
}
