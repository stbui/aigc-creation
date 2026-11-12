import { useCallback, useEffect, useState } from 'react';

/** 右侧面板页签：功能示例 / 创作结果 */
export type RightTab = 'demo' | 'results';

/**
 * 右侧面板页签。
 *
 * 首访展示功能示例；已有历史结果时自动落到创作结果。用户自己点过页签后
 * 不再自动切换，避免正在看示例时被晚到的列表请求弹走。
 *
 * `showResults` 供提交时调用：占位卡在结果区，留在示例页看不到进度。
 * 商品主图 / 商品详情 / 爆款复刻共用同一份落位规则。
 */
export function useRightTab(itemCount: number, loading: boolean) {
  const [rightTab, setRightTab] = useState<RightTab>('demo');
  const [touched, setTouched] = useState(false);

  const pick = useCallback((tab: RightTab) => {
    setTouched(true);
    setRightTab(tab);
  }, []);

  const showResults = useCallback(() => setRightTab('results'), []);

  useEffect(() => {
    if (touched || loading) return;
    if (itemCount > 0) setRightTab('results');
  }, [touched, loading, itemCount]);

  return { rightTab, pick, showResults };
}
