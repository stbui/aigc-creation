/**
 * 商品详情图页面的纯函数与外部工具入口 —— 目录内文件的唯一外部工具来源。
 *
 * 约定:
 *   - 本文件内的函数不依赖 React，可被页面、组件与 hooks 共用；
 *   - 目录内文件不从 `src/lib/*` 直接取东西，一律经由本文件；
 *   - 常量、类型与默认值在 `constants.ts`，外部接口 / 控件 / hook 分别走
 *     `api.ts` / `components.ts` / `hooks.ts`。
 * 目录内新增外部工具引用时在这里补一行 re-export。
 */

import type { GalleryItem } from './hooks';
import { MAX_SECTIONS, SECTION_VALUES } from './constants';
import {
  buildProductBatchRows,
  countGenerations as countGenerationsOf,
  downloadFileName as downloadFileNameOf,
  formatBatchDate,
  rowKeyOf as rowKeyOfItem,
  textParam as textParamOf,
  type ProductBatchRow,
} from '../../components/batchResult';
import { languageOptions, platformDetailSpec, platformOptions } from '../../lib/optionSets';

/* ------------------------------------------------------------------------- */
/* 外部工具转出                                                             */
/* ------------------------------------------------------------------------- */

/** 平台 / 语言选项集（读自后端能力清单） */
export { languageOptions, platformDetailSpec, platformOptions };
/** 缩略图地址换算 */
export { assetThumbUrl } from '../../lib/api';

/* ------------------------------------------------------------------------- */
/* 任务参数 → 展示口径                                                      */
/* ------------------------------------------------------------------------- */

/**
 * 任务参数里的模块清单 → 缩略图标签。
 *
 * 按模块出图后, 每张图自己的标签由 `sectionLabel` 提供; 这个函数只用于
 * 改造前「一次出一张长图」的存量任务 —— 它们没有 sectionLabel, 用模块数说明版面。
 */
export function sectionCaption(params: Record<string, unknown>): string | undefined {
  const raw = params?.sections;
  if (typeof raw !== 'string') return undefined;
  const n = raw.split(',').filter(Boolean).length;
  return n > 0 ? `${n} 个模块` : undefined;
}

/* ------------------------------------------------------------------------- */
/* 结果批次归组                                                             */
/* ------------------------------------------------------------------------- */

/** 行内的一格: 原图或一张模块图 */
export type { CellState } from '../../components/batchResult';
export { batchIndexOf, cellState } from '../../components/batchResult';

/** 一行 = 一次生成 (批次内全部任务) */
export type ResultRow = ProductBatchRow;

/** 结果卡参数摘要与状态口径（与商品主图共用） */
export type { ResultMeta, ResultStatusTone } from '../../components/batchResult';
export { resultMetaOf, resultStatusOf } from '../../components/batchResult';

/** 格子的模块名: 优先任务参数里的 sectionLabel, 回落任务 caption */
export function labelOf(item: GalleryItem): string {
  const label = item.params?.sectionLabel;
  if (typeof label === 'string' && label.trim()) return label.trim();
  return item.caption || '详情图';
}

/** 取任务参数里的字符串参数; 非字符串或空串返回 undefined */
export const textParam = textParamOf;

/** 归组键: 同批次共享 `batch:…`, 旧任务各自 `task:…` */
export const rowKeyOf = rowKeyOfItem;

/**
 * 结果行数（一次生成 = 一行），供页签角标使用。
 *
 * 页签上直接写任务数会把「6 个模块」显示成 6, 与「生成了几次」是两回事;
 * 角标语义必须和下方列表的行数一致。
 */
export const countGenerations = countGenerationsOf;

/** 按 batchId 归组; 无 batchId 的任务各自成行。列表本身已按时间倒序 */
export function buildRows(items: GalleryItem[]): ResultRow[] {
  return buildProductBatchRows(items);
}

/* ------------------------------------------------------------------------- */
/* 重新生成: 历史批次 → 左栏表单                                             */
/* ------------------------------------------------------------------------- */

/** 一次生成回填左栏所需的表单快照 */
export interface DetailFormSnapshot {
  productName: string;
  brand: string;
  platform: string;
  language: string;
  description: string;
  sections: string[];
  ratio: string;
  resolution: string;
  /** 原图素材 (id 用于再次提交, url 用于图片位展示) */
  images: Array<{ id: string; url: string; name: string }>;
}

/** 任务参数里的模块清单: 兼容逗号串与旧任务的数组形态, 只留当前模块并按固定顺序排列 */
function snapshotSections(raw: unknown): string[] {
  const list = Array.isArray(raw)
    ? raw.filter((value): value is string => typeof value === 'string')
    : typeof raw === 'string'
      ? raw.split(',')
      : [];
  const picked = new Set(list.map((value) => value.trim()).filter(Boolean));
  return SECTION_VALUES.filter((value) => picked.has(value)).slice(0, MAX_SECTIONS);
}

/**
 * 从一次生成的任务快照还原左栏表单。
 *
 * 同批各任务的表单参数完全一致（只有 `sectionLabel` / `batchIndex` 不同），
 * 因此只读首格；缺字段返回空串，让回填后的表单与当初提交的一致，
 * 而不是悄悄沿用当前表单里的残留值。
 */
export function formSnapshotOf(items: GalleryItem[]): DetailFormSnapshot | null {
  const first = items[0];
  if (!first) return null;
  const text = (key: string) => textParam(first, key) ?? '';
  return {
    productName: text('productName'),
    brand: text('brand'),
    platform: text('platform'),
    language: text('language'),
    description: text('description'),
    sections: snapshotSections(first.params?.sections),
    ratio: text('ratio'),
    resolution: text('size'),
    images: (first.inputAssets ?? []).map((asset, index) => ({
      id: asset.id,
      url: asset.url,
      name: asset.name || `原图 ${index + 1}`,
    })),
  };
}

/* ------------------------------------------------------------------------- */
/* 时间与文件名                                                             */
/* ------------------------------------------------------------------------- */

/** 行头时间: 本地时区 `YYYY-MM-DD HH:mm`; 解析失败时不显示 */
export const formatDate = formatBatchDate;

/**
 * 下载文件名: `<前缀>-<模块名>-<任务 id 尾 6 位>.<真实格式>`。
 *
 * 扩展名跟真实格式走: 厂商链接常常没有后缀, 猜后缀会把 PNG 存成 .jpg。
 */
export function downloadFileName(
  item: GalleryItem,
  downloadNamePrefix = 'product-detail',
): string {
  return downloadFileNameOf(item, labelOf(item), downloadNamePrefix);
}
