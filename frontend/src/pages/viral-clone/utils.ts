import { DEGREE_LABEL } from './constants';

/**
 * 爆款复刻工作台页面的纯函数与外部工具入口 —— 目录内文件的唯一外部工具来源。
 *
 * 约定: `viral-clone/` 下的文件不从 `src/lib/*` 直接取东西, 一律经由本文件 ——
 * 页面用到的图片校验、选项集、轮询与错误文案集中可见, 换实现只改一处。
 * 目录内新增外部工具引用时在这里补一行 re-export。
 */

/** 上传前的图片格式校验 */
export { isSupportedImageFile } from '../../lib/constants';
/** 任务错误码 → 用户可读文案 */
export { taskErrorText } from '../../lib/constants';
/** 平台 / 语言 / 平台规格（读自后端能力清单） */
export { languageOptions, platformOptions, platformSpec } from '../../lib/optionSets';
/** 任务轮询到终态 */
export { pollToResult } from '../../lib/poll';

/**
 * 任务参数里的复刻程度 → 缩略图标签。
 *
 * 本页唯一会显著改变产出观感的维度就是复刻程度 (参考风格 / 高度复刻),
 * 两种结果混在一格里若不带标签, 用户无法知道自己看的是哪一档。
 * 后台认不出的度数原样显示, 不吞掉信息。
 */
export function degreeCaption(params: Record<string, unknown>): string | undefined {
  const v = params?.degree;
  return typeof v === 'string' ? (DEGREE_LABEL[v] ?? v) : undefined;
}


/**
 * 拆出爆款复刻任务的商品图与参考图。
 *
 * 提交顺序由后端保留为 `[商品图..., 参考图]`；历史任务若只拿到一张图，
 * 无法可靠判断它是哪一端，按商品图展示，避免把商品误标成参考图。
 */
export function splitCloneInputs(inputUrls: string[] | undefined): {
  productUrls: string[];
  referenceUrl: string | null;
} {
  const urls = (inputUrls ?? []).filter(Boolean);
  if (urls.length < 2) return { productUrls: urls, referenceUrl: null };
  return {
    productUrls: urls.slice(0, -1),
    referenceUrl: urls[urls.length - 1] ?? null,
  };
}
