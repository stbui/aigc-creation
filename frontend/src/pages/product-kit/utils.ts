import { VARIANT_FIELDS, VARIANT_LABELS } from './constants';
import { assetsApi, assetSrc, type Asset } from './api';
import type { GalleryItem, UploadedImage } from './hooks';
import { modelImageInputLimit, type PublicLogicalModel } from '../../lib/models';
import { buildBatchRows, formatBatchDate, type BatchRowBase } from '../../components/batchResult';

/**
 * 商品主图工作台页面的纯函数与外部工具入口 —— 目录内文件的唯一外部工具来源。
 *
 * 约定: `product-kit/` 下的文件不从 `src/lib/*` 直接取东西, 一律经由本文件 ——
 * 页面用到的选项集、结果归组与下载命名集中可见, 换实现只改一处。
 * 目录内新增外部工具引用时在这里补一行 re-export。
 */

/** 平台 / 语言 / 平台规格（读自后端能力清单） */
export { languageOptions, platformOptions, platformSpec } from '../../lib/optionSets';
/** 缩略图地址换算 */
export { assetThumbUrl } from '../../lib/api';
/** 模型能力合同里的图片输入上限 */
export { modelImageInputLimit } from '../../lib/models';


/* ------------------------------------------------------------------------- */
/* 模型输入约束                                                             */
/* ------------------------------------------------------------------------- */

/**
 * 素材数量超过模型能力合同时的可读原因。
 *
 * 前端页面上限与模型上限是两个概念：页面允许保留 5 个输入位，但模型合同
 * 可能只接受 4 张。超限时必须在建单前明确拦住，绝不静默丢掉用户素材 ——
 * 否则用户会误以为 5 张都参与了生成。
 */
export function imageInputCountError(
  model: Pick<PublicLogicalModel, 'name' | 'capabilitySpec'>,
  imageCount: number,
): string | null {
  const max = modelImageInputLimit(model);
  if (max === null || imageCount <= max) return null;
  return `所选模型「${model.name}」最多支持 ${max} 张商品图，请移除 ${imageCount - max} 张或切换模型`;
}

/* ------------------------------------------------------------------------- */
/* 提交计划                                                                 */
/* ------------------------------------------------------------------------- */

/**
 * 自定义配置计数 → 本次要创建的变体清单。
 *
 * 一类变体填 3 就重复出现 3 次（每张独立建任务、各扣一份单价），顺序与
 * `VARIANT_FIELDS` 一致。页签角标与价签的「本次张数」都按这份清单的长度计，
 * 与 `page.tsx` 实际提交的任务数同源。
 */
export function buildVariantPlan(counts: Record<string, number>): string[] {
  const plan: string[] = [];
  for (const field of VARIANT_FIELDS) {
    const count = counts[field.key] ?? 0;
    for (let i = 0; i < count; i += 1) plan.push(field.key);
  }
  return plan;
}

/* ------------------------------------------------------------------------- */
/* 输入素材归属                                                             */
/* ------------------------------------------------------------------------- */

/** 调用外部素材接口所需的最小返回形态，便于单测注入替身 */
export interface AssetFetchResult {
  ok: boolean;
  status: number;
  blob(): Promise<Blob>;
}

/** `ensureAssetsInProject` 的外部依赖；生产代码使用下方默认实现 */
export interface AssetCopyDependencies {
  getAsset: (id: string) => Promise<Asset>;
  uploadAsset: (file: File, projectId: string) => Promise<Asset>;
  fetchAsset: (url: string) => Promise<AssetFetchResult>;
}

export interface EnsureAssetsInProjectOptions extends Partial<AssetCopyDependencies> {
  /** 每准备好一张就回调，页面可即时替换输入位，避免失败重试重复复制 */
  onPrepared?: (originalId: string, next: UploadedImage) => void;
}

const defaultAssetCopyDependencies: AssetCopyDependencies = {
  getAsset: assetsApi.get,
  uploadAsset: assetsApi.upload,
  fetchAsset: (url) => fetch(url, { mode: 'cors', credentials: 'omit' }),
};

function extensionOfMime(mime: string): string | undefined {
  if (!mime.includes('/')) return undefined;
  const subtype = mime.split('/')[1]?.split(';')[0]?.trim().toLowerCase();
  if (!subtype) return undefined;
  return subtype.replace('jpeg', 'jpg').replace('svg+xml', 'svg').replace(/\+.*$/, '');
}

function extensionOfUrl(url: string): string | undefined {
  try {
    const pathname = new URL(url, 'http://localhost').pathname;
    return pathname.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
  } catch {
    return undefined;
  }
}

function mimeOf(blobType: string, format: string, extension: string): string {
  if (blobType) return blobType;
  if (format.includes('/')) return format;
  const normalized = (format || extension).toLowerCase().replace(/^\./, '');
  return `image/${normalized === 'jpg' ? 'jpeg' : normalized || 'png'}`;
}

function copyFileName(name: string, id: string, extension: string): string {
  const base = name.replace(/[/\\]/g, '_').replace(/\.[^.]+$/, '').trim() || 'asset';
  return `${base}-${id.slice(-6)}.${extension}`;
}

/**
 * 在提交前把输入图统一准备到目标项目。
 *
 * 后端任务准入要求 `inputAssetIds` 与任务属于同一项目；素材库又允许浏览账号
 * 下所有项目的素材。跨项目选中时直接提交必然报「部分输入素材不存在或无权限」。
 * 这里沿用历史结果复用语义：先取素材、下载 Blob、再上传到目标项目，**移动**
 * 用户原素材会改变其素材分组归属，不能作为提交副作用。页面缓存里的
 * `projectId` 可能已经过期，因此即使看起来同项目也必须以服务端记录为准。
 *
 * 单张复制成功即通过 `onPrepared` 回写页面状态；若后续某张失败，下一次重试
 * 不会重复复制已成功的图。复制失败绝不回退为跨项目 id 提交。
 */
export async function ensureAssetsInProject(
  images: UploadedImage[],
  targetProjectId: string,
  options: EnsureAssetsInProjectOptions = {},
): Promise<UploadedImage[]> {
  const dependencies = { ...defaultAssetCopyDependencies, ...options };
  const prepared: UploadedImage[] = [];

  for (const image of images) {
    let asset: Asset;
    try {
      asset = await dependencies.getAsset(image.id);
    } catch {
      throw new Error(`素材「${image.name}」不存在或无权限，请重新选择`);
    }

    if (asset.projectId === targetProjectId) {
      const next: UploadedImage = {
        ...image,
        url: assetSrc(asset) ?? image.url,
        projectId: targetProjectId,
      };
      prepared.push(next);
      options.onPrepared?.(image.id, next);
      continue;
    }

    const src = assetSrc(asset) ?? image.url;
    if (!src) {
      throw new Error(`素材「${image.name}」地址不可用，请重新选择`);
    }

    try {
      const response = await dependencies.fetchAsset(src);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      if (!blob.size) throw new Error('图片内容为空');

      const extension = extensionOfMime(blob.type)
        ?? extensionOfMime(asset.format)
        ?? extensionOfUrl(src)
        ?? 'png';
      const mime = mimeOf(blob.type, asset.format, extension);
      const file = new File([blob], copyFileName(image.name, image.id, extension), { type: mime });
      const uploaded = await dependencies.uploadAsset(file, targetProjectId);
      const next: UploadedImage = {
        id: uploaded.id,
        url: assetSrc(uploaded) ?? src,
        name: image.name,
        projectId: targetProjectId,
      };
      prepared.push(next);
      options.onPrepared?.(image.id, next);
    } catch {
      throw new Error(`素材「${image.name}」属于其他项目，复制失败，请稍后重试`);
    }
  }

  return prepared;
}

/**
 * 任务参数里的变体 → 中文标签。
 *
 * 后端定义在 `definitions/param-options.ts` 的 `MAIN_IMAGE_VARIANTS`,
 * 这里的 `VARIANT_LABELS` 与之一一对应; 认不出的变体原样显示, 不吞掉信息。
 */
export function variantCaption(params: Record<string, unknown>): string | undefined {
  const v = params?.variant;
  return typeof v === 'string' ? (VARIANT_LABELS[v] ?? v) : undefined;
}

/* ------------------------------------------------------------------------- */
/* 结果批次归组                                                             */
/* ------------------------------------------------------------------------- */

/** 行内的一格: 原图或一张主图 */
export type { CellState } from '../../components/batchResult';
export { batchIndexOf, cellState } from '../../components/batchResult';

/** 一行 = 一次生成 (批次内全部任务); 页面在公共字段之外多带提示词与商品名 */
export interface ResultRow extends BatchRowBase {
  prompt?: string;
  productName?: string;
}

/** 主图格的变体名: 优先任务 caption, 回落「商品主图」 */
export function labelOf(item: GalleryItem): string {
  return item.caption || variantCaption(item.params ?? {}) || '商品主图';
}

/** 取任务参数里的字符串参数; 非字符串或空串返回 undefined */
export function textParam(item: GalleryItem, key: string): string | undefined {
  const value = item.params?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/** 归组键: 同批次共享 `batch:…`, 旧任务各自 `task:…` */
export function rowKeyOf(item: GalleryItem): string {
  const batchId = textParam(item, 'batchId');
  return batchId ? `batch:${batchId}` : `task:${item.id}`;
}

/**
 * 结果行数（一次生成 = 一行），供页签角标使用。
 *
 * 页签上直接写任务数会把「一次生成 5 张」显示成 5 次；角标语义必须和
 * 下方列表的行数一致。
 */
export function countGenerations(items: GalleryItem[]): number {
  return new Set(items.map(rowKeyOf)).size;
}

/** 按 batchId 归组; 无 batchId 的任务各自成行。列表本身已按时间倒序 */
export function buildRows(items: GalleryItem[]): ResultRow[] {
  return buildBatchRows<{ prompt?: string; productName?: string }>(
    items,
    (item) => ({
      prompt: textParam(item, 'description'),
      productName: textParam(item, 'productName'),
    }),
    rowKeyOf,
  );
}

/* ------------------------------------------------------------------------- */
/* 时间与文件名                                                             */
/* ------------------------------------------------------------------------- */

/** 行头时间: 本地时区 `YYYY-MM-DD HH:mm`; 解析失败时不显示 */
export const formatDate = formatBatchDate;

/**
 * 下载文件名: `<前缀>-<变体名>-<任务 id 尾 6 位>.<真实格式>`。
 *
 * 扩展名跟真实格式走，避免把 PNG 存成 .jpg。
 */
export function downloadFileName(
  item: GalleryItem,
  downloadNamePrefix = 'main-image',
): string {
  const ext = (item.format || 'png').toLowerCase().replace(/^\./, '') || 'png';
  return `${downloadNamePrefix}-${labelOf(item)}-${item.id.slice(-6)}.${ext}`;
}
