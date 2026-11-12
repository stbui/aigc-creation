import { DEGREE_LABEL, MAX_IMAGES } from './constants';
import { modelImageInputLimit, type PublicLogicalModel } from './api';

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
/** 任务轮询到终态; `PolledResult` 是本页「本次提交结果」的类型 */
export { pollToResult, type PolledResult } from '../../lib/poll';


/* ------------------------------------------------------------------------- */
/* 模型输入约束                                                             */
/* ------------------------------------------------------------------------- */

/**
 * 商品图位上限。
 *
 * 爆款复刻必须额外提交 1 张参考图，而模型合同限制的是两者总数；
 * 因此商品图只能占用“总数上限 - 1”个位置。目录还没加载时保留页面上限，
 * 提交前仍会按真实模型再校验一次。
 */
export function viralCloneProductImageLimit(totalImageMax: number | null): number {
  if (totalImageMax === null) return MAX_IMAGES;
  return Math.min(MAX_IMAGES, Math.max(0, totalImageMax - 1));
}

/** 商品图 + 参考图总数超过模型能力合同时的可读原因。 */
export function viralCloneImageInputError(
  model: Pick<PublicLogicalModel, 'name' | 'capabilitySpec'>,
  imageCount: number,
): string | null {
  const max = modelImageInputLimit(model);
  if (max === null || imageCount <= max) return null;
  return `所选模型「${model.name}」最多支持 ${max} 张输入图片（商品图 + 参考图），当前 ${imageCount} 张，请移除 ${imageCount - max} 张或切换模型`;
}

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
 * 下载文件扩展名。
 *
 * 后端资产的 `format` 是 MIME 类型（如 `image/png`），不能直接拼进文件名；
 * 同时兼容历史数据里已经存成 `png` / `.png` 的格式。
 */
export function downloadExtension(format: string | null | undefined): string {
  const normalized = (format || '').trim().toLowerCase().replace(/^\./, '');
  if (!normalized) return 'png';

  const mimeSubtype = normalized.replace(/^image\//, '').split(';', 1)[0]?.trim() || '';
  const aliases: Record<string, string> = {
    jpeg: 'jpg',
    'svg+xml': 'svg',
    'x-icon': 'ico',
    'vnd.microsoft.icon': 'ico',
  };
  const extension = aliases[mimeSubtype] ?? mimeSubtype.split('+', 1)[0] ?? '';
  return /^[a-z0-9]+$/.test(extension) ? extension : 'png';
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
