import { COLOR_LABEL } from './constants';

/**
 * 一键抠图页面的纯函数 —— 目录内文件的唯一本页工具来源。
 *
 * 本页的外部依赖 (接口 / 组件 / hook) 分别走 `api.ts` / `components.ts` /
 * `hooks.ts`; 这里只放不依赖 React 的展示口径换算。
 */

/**
 * 结果标签文案: 自定义色带 HEX 与不透明度, 预设色查中文名。
 *
 * 与页面展示逐字一致 —— 结果上方的色标必须和用户选的那一档完全对应,
 * 否则同一张结果会说不清是哪个背景色, 所以提取出来单测。
 */
export function colorLabelOf(selectedColor: string, customColor: string, customAlpha: number): string {
  if (selectedColor === 'custom') {
    return `自定义 ${customColor}${customAlpha < 100 ? ` · ${customAlpha}%` : ''}`;
  }
  return COLOR_LABEL[selectedColor] ?? selectedColor;
}
