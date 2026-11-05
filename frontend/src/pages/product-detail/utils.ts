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
import { buildBatchRows, cellState, formatBatchDate, type BatchRowBase } from '../../components/batchResult';
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

/** 一行 = 一次生成 (批次内全部任务); 页面在公共字段之外多带提示词与商品名 */
export interface ResultRow extends BatchRowBase {
  prompt?: string;
  productName?: string;
  /** 结果卡第二行展示的任务参数；同批次内各任务共用一份 */
  meta: ResultMeta;
}

/** 商品详情结果卡的参数摘要 */
export interface ResultMeta {
  resolution?: string;
  ratio?: string;
  platform?: string;
  country?: string;
  language?: string;
}

/** 输出语言的地区码 → 国家/地区展示名。取值来自当前 LANGUAGES 的 locale 列表。 */
const COUNTRY_BY_REGION: Record<string, string> = {
  CN: '中国',
  US: '美国',
  RU: '俄罗斯',
  ES: '西班牙',
  DE: '德国',
  JP: '日本',
  KR: '韩国',
  PT: '葡萄牙',
  ID: '印度尼西亚',
  TH: '泰国',
};

function optionLabel(options: Array<{ value: string | number; label: string }>, value?: string): string | undefined {
  if (!value) return undefined;
  return options.find((option) => String(option.value) === value)?.label ?? value;
}

/** 从任务参数提取结果卡参数摘要。缺失字段不补默认值，避免把旧任务伪装成新参数。 */
export function resultMetaOf(item: GalleryItem): ResultMeta {
  const language = textParam(item, 'language');
  const region = language?.split('-')[1]?.toUpperCase();
  return {
    resolution: textParam(item, 'size'),
    ratio: textParam(item, 'ratio'),
    platform: optionLabel(platformOptions(), textParam(item, 'platform')),
    country: region ? COUNTRY_BY_REGION[region] : undefined,
    language: optionLabel(languageOptions(), language),
  };
}

export type ResultStatusTone = 'processing' | 'done' | 'partial' | 'failed';

/** 批次状态：任一生成中 → 生成中；终态后按成功/失败数量区分。 */
export function resultStatusOf(cells: GalleryItem[]): { label: string; tone: ResultStatusTone } {
  const ready = cells.filter((item) => cellState(item) === 'ready').length;
  const failed = cells.filter((item) => cellState(item) === 'failed').length;
  if (cells.some((item) => cellState(item) === 'pending')) return { label: '生成中', tone: 'processing' };
  if (failed > 0 && ready > 0) return { label: '部分失败', tone: 'partial' };
  if (failed > 0) return { label: '生成失败', tone: 'failed' };
  return { label: '已完成', tone: 'done' };
}

/** 格子的模块名: 优先任务参数里的 sectionLabel, 回落任务 caption */
export function labelOf(item: GalleryItem): string {
  const label = item.params?.sectionLabel;
  if (typeof label === 'string' && label.trim()) return label.trim();
  return item.caption || '详情图';
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
 * 页签上直接写任务数会把「6 个模块」显示成 6, 与「生成了几次」是两回事;
 * 角标语义必须和下方列表的行数一致。
 */
export function countGenerations(items: GalleryItem[]): number {
  return new Set(items.map(rowKeyOf)).size;
}

/** 按 batchId 归组; 无 batchId 的任务各自成行。列表本身已按时间倒序 */
export function buildRows(items: GalleryItem[]): ResultRow[] {
  return buildBatchRows<{ prompt?: string; productName?: string; meta: ResultMeta }>(
    items,
    (item) => ({
      prompt: textParam(item, 'description'),
      productName: textParam(item, 'productName'),
      meta: resultMetaOf(item),
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
 * 下载文件名: `<前缀>-<模块名>-<任务 id 尾 6 位>.<真实格式>`。
 *
 * 扩展名跟真实格式走: 厂商链接常常没有后缀, 猜后缀会把 PNG 存成 .jpg。
 */
export function downloadFileName(
  item: GalleryItem,
  downloadNamePrefix = 'product-detail',
): string {
  const ext = (item.format || 'png').toLowerCase().replace(/^\./, '') || 'png';
  return `${downloadNamePrefix}-${labelOf(item)}-${item.id.slice(-6)}.${ext}`;
}
