/**
 * 智能扩图页面的常量 —— 目录内文件的唯一常量入口。
 *
 * 占比区间与九宫格位置表是「输入校验 + 提交参数 + 结果标签」三处的共同事实源:
 * 任何一处改了范围或位置名，另外两处必须同步，所以集中在这里。
 *
 * 约定: `image-expand/` 下的文件不从 `src/lib/constants` 直接取东西,
 * 一律经由本文件或 `./components` —— 目录内新增共享常量时在这里补一行。
 */

/** 原图占比快捷档位 (%) */
export const QUICK_PERCENTS = [100, 80, 60, 50];

/** 自定义占比下限 (%) */
export const OCCUPY_MIN = 1;
/** 自定义占比上限 (%) */
export const OCCUPY_MAX = 99;
/** 默认档位: 与参考站一致, 80% */
export const DEFAULT_OCCUPY = 80;

/** 九宫格位置 → 中文名 (结果标签用) */
export const POSITION_LABEL: Record<string, string> = {
  'top-left': '左上',
  top: '上',
  'top-right': '右上',
  left: '左',
  center: '居中',
  right: '右',
  'bottom-left': '左下',
  bottom: '下',
  'bottom-right': '右下',
};
