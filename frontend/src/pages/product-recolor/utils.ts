import { COLOR_LABEL } from '../../lib/colorPalette';

/**
 * 商品换色页面的纯函数 —— 目录内文件的唯一本页工具来源。
 *
 * 本页的外部依赖 (接口 / 组件 / hook) 分别走 `api.ts` / `components.ts` /
 * `hooks.ts`; 这里只放不依赖 React、也不依赖组件的颜色换算与参数拼装,
 * 以及 `src/lib` 工具的转出。
 */

/** HEX 归一化 / 合法性校验 (页面输入框用) */
export { isValidHexColor, normalizeHexColor } from '../../lib/colorPalette';

/** 提交给 `useToolTask` 的高级设置 (与 `ToolShell` 回传一致) */
export interface RecolorSettings {
  ratio: string;
  resolution: string;
}

/**
 * 实际要换成的颜色: 自定义档取输入框原值, 预设档就是色值本身。
 * 结果标签与提交参数都以它为准。
 */
export function targetColorOf(color: string, customColor: string): string {
  return color === 'custom' ? customColor : color;
}

/** 结果标签: 预设色查中文名, 自定义回落输入框里的 HEX 原值 (不做归一化)。 */
export function colorLabelOf(color: string, customColor: string): string {
  return COLOR_LABEL[color] ?? targetColorOf(color, customColor);
}

/**
 * 把「颜色选择 + 归一化后的自定义色 + 高级设置」拼成换色任务参数。
 *
 * - `customColor` 始终下发 (无自定义时为空串), 后端两条读法都认;
 * - `targetColor` 在自定义档用归一化值, 预设档用色值原样去空格 ——
 *   用户可能选的是色板项, 不该被二次改写;
 * - 归一化本身由页面经 `./components` 的 `normalizeHexColor` 完成,
 *   保持 `utils → constants` 的单向依赖。
 */
export function recolorPayload(
  color: string,
  normalizedCustom: string,
  settings: RecolorSettings,
): Record<string, unknown> {
  return {
    targetColor: color === 'custom' ? normalizedCustom : color.trim(),
    customColor: normalizedCustom,
    ratio: settings.ratio,
    size: settings.resolution,
  };
}

/**
 * 读取图片宽高比, 供结果占位卡片按原图比例撑开。
 *
 * 刻意不返回 Promise: 页面发起测量后立刻提交任务, 比例回来时再刷新占位,
 * 不能让一次图片加载挡住扣费。加载失败或尺寸非法时回调不触发, 保持上一个值。
 */
export function measureImageAspect(url: string, onMeasured: (aspect: number) => void): void {
  const image = new Image();
  image.onload = () => {
    if (image.naturalWidth > 0 && image.naturalHeight > 0) {
      onMeasured(image.naturalWidth / image.naturalHeight);
    }
  };
  image.src = url;
}
