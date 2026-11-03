/**
 * AI 带货图文页面的纯函数与外部工具入口 —— 目录内文件的唯一外部工具来源。
 *
 * 约定: `shoppable-carousel/` 下的文件不从 `src/lib/*` 直接取东西, 一律经由
 * 本文件 —— 页面用到的选项集、结果归组与下载命名集中可见, 换实现只改一处。
 * 目录内新增外部工具引用时在这里补一行 re-export。
 */

/** 缩略图地址换算 */
export { assetThumbUrl } from '../../lib/api';

import type { GalleryItem } from './hooks';
import { buildBatchRows, formatBatchDate, type BatchRowBase } from '../../components/batchResult';

/* ------------------------------------------------------------------------- */
/* 模板筛选                                                                 */
/* ------------------------------------------------------------------------- */

/**
 * 按分类筛选模板。
 *
 * `categoryId` 为空表示「全部模板」—— 页面级筛选态，不来自后端。
 * 一个模板可跨分类（参考站有 5 个模板挂在两个分类下），命中任一即入选。
 */
export function filterTemplatesByCategory<T extends { categoryIds: readonly string[] }>(
  templates: readonly T[],
  categoryId: string,
): T[] {
  if (!categoryId) return [...templates];
  return templates.filter((template) => template.categoryIds.includes(categoryId));
}

/**
 * 模板 → 卡片副标题（三拍文案）。
 *
 * 参考站卡片结构实测：标题 + 「拍1 → 拍2 → 拍3」两行。
 */
export function templateBeatsText(template: { beats: readonly string[] }): string {
  return template.beats.join(' → ');
}

/* ------------------------------------------------------------------------- */
/* 生成张数                                                                 */
/* ------------------------------------------------------------------------- */

/**
 * 生成张数 → 收敛到区间。
 *
 * 前后端都收敛：前端步进器是软约束，直接调接口能传越界张数
 * （每张一份账单，不收敛就是资损入口）。
 */
export function clampCount(raw: number, min: number, max: number): number {
  if (!Number.isFinite(raw)) return min;
  return Math.min(max, Math.max(min, Math.round(raw)));
}

/* ------------------------------------------------------------------------- */
/* 结果批次归组                                                             */
/* ------------------------------------------------------------------------- */

/** 行内的一格: 产出图 */
export type { CellState } from '../../components/batchResult';
export { batchIndexOf, cellState } from '../../components/batchResult';

/** 一行 = 一次生成 (批次内全部任务); 页面在公共字段之外多带卖点与模板 */
export interface ResultRow extends BatchRowBase {
  /** 卖点文案 (提交时的输入) */
  sellingPoints?: string;
  /** 模板名 */
  templateName?: string;
}

/** 格子的展示名: 优先任务 caption, 回落「第 N 张」 */
export function labelOf(item: GalleryItem): string {
  if (item.caption) return item.caption;
  const shot = Number(item.params?.shotIndex);
  return Number.isFinite(shot) && shot > 0 ? `第 ${shot} 张` : '带货图文';
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
 * 页签上直接写任务数会把「一次生成 6 张」显示成 6 次；角标语义必须和
 * 下方列表的行数一致。
 */
export function countGenerations(items: GalleryItem[]): number {
  return new Set(items.map(rowKeyOf)).size;
}

/** 按 batchId 归组; 无 batchId 的任务各自成行。列表本身已按时间倒序 */
export function buildRows(items: GalleryItem[]): ResultRow[] {
  return buildBatchRows<{ sellingPoints?: string; templateName?: string }>(
    items,
    (item) => ({
      sellingPoints: textParam(item, 'sellingPoints'),
      templateName: textParam(item, 'templateName'),
    }),
    rowKeyOf,
  );
}

/* ------------------------------------------------------------------------- */
/* 时间与文件名                                                             */
/* ------------------------------------------------------------------------- */

const pad2 = (n: number) => String(n).padStart(2, '0');

/** 行头时间: 本地时区 `YYYY-MM-DD HH:mm`; 解析失败时不显示 */
export const formatDate = formatBatchDate;

/**
 * 短日期: `MM-DD HH:mm`。
 *
 * 底部历史条的卡片只有 90px 宽, 完整 `YYYY-MM-DD HH:mm` 放不下会被截成
 * 「2026-11-03 16:22」中间断开。完整时间仍在卡片的 title 与「全部记录」里。
 */
export function formatShortDate(iso?: string): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return `${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

/**
 * 下载文件名: `<前缀>-<格标签>-<任务 id 尾 6 位>.<真实格式>`。
 *
 * 扩展名跟真实格式走，避免把 PNG 存成 .jpg。
 */
export function downloadFileName(
  item: GalleryItem,
  downloadNamePrefix = 'shoppable-carousel',
): string {
  const ext = (item.format || 'png').toLowerCase().replace(/^\./, '') || 'png';
  return `${downloadNamePrefix}-${labelOf(item)}-${item.id.slice(-6)}.${ext}`;
}
