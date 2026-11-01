import { computeExpandPlacement } from '../../lib/expandGeometry';
import { OCCUPY_MAX, OCCUPY_MIN, POSITION_LABEL } from './constants';

/**
 * 智能扩图页面的纯函数与外部工具入口 —— 目录内文件的唯一外部工具来源。
 *
 * 约定: `image-expand/` 下的文件不从 `src/lib/*` 直接取东西, 一律经由本文件 ——
 * 页面用到的 placement 几何、图片尺寸与占比校验集中可见。
 * 目录内新增外部工具引用时在这里补一行 re-export。
 */

/** 扩图 placement 几何: 按源图尺寸、目标画幅、占比与位置算出原图落点 */
export { computeExpandPlacement } from '../../lib/expandGeometry';
/** 读取图片自然尺寸 (提交前算 placement 用) */
export { loadImageSize } from '../../lib/expandGeometry';

/** 提交给 `useToolTask` 的高级设置 (与 `ToolShell` 回传一致) */
export interface ExpandSettings {
  ratio: string;
  resolution: string;
}

/**
 * 输入框文本是否处于可提交状态。
 *
 * 空串表示「未自定义」—— 沿用快捷档位，是合法的；非空则必须是
 * 1-99 的整数，`12.5` / `0` / `100` 都拦住。
 */
export function isOccupyInputValid(text: string): boolean {
  if (text === '') return true;
  const value = Number(text);
  return Number.isInteger(value) && value >= OCCUPY_MIN && value <= OCCUPY_MAX;
}

/**
 * 生效占比: 自定义输入合法时立即生效，不必等失焦；
 * 非法输入不覆盖上一次有效档位 (同时 `isOccupyInputValid` 会拦住提交)。
 */
export function effectiveOccupyOf(text: string, fallback: number): number {
  const value = Number(text);
  if (text !== '' && Number.isInteger(value) && value >= OCCUPY_MIN && value <= OCCUPY_MAX) {
    return value;
  }
  return fallback;
}

/**
 * 失焦 / 回车时把合法输入提交成新档位；非法输入返回 `null`，调用方保持原档。
 */
export function committedOccupyOf(text: string): number | null {
  const value = Number(text);
  return Number.isInteger(value) && value >= OCCUPY_MIN && value <= OCCUPY_MAX ? value : null;
}

/** 位置 → 中文名; 未配置的位置返回 `undefined`, 结果标签不显示该段。 */
export function positionLabelOf(position: string): string | undefined {
  return POSITION_LABEL[position];
}

/**
 * 把「源图尺寸 + 高级设置 + 占比 + 位置」拼成扩图任务参数。
 *
 * 固定比例才带 `targetImageRatio`；`ratio` 与 `size` 始终下发。
 * placement 由源图与目标画幅共同决定 —— 只按 `occupy/100` 提交会让服务端
 * 把原图拉伸到错误比例，所以四个落点字段一并带上。
 */
export function expandPayload(
  sourceWidth: number,
  sourceHeight: number,
  settings: ExpandSettings,
  occupy: number,
  position: string,
): Record<string, unknown> {
  const placement = computeExpandPlacement(
    sourceWidth,
    sourceHeight,
    settings.ratio,
    occupy,
    position,
  );
  return {
    occupy,
    position,
    ...placement,
    ...(settings.ratio !== 'original' ? { targetImageRatio: settings.ratio } : {}),
    ratio: settings.ratio,
    size: settings.resolution,
  };
}
