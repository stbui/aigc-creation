import type { GalleryItem } from '../hooks/useResultGallery';
import { languageOptions, platformOptions } from '../lib/optionSets';

/**
 * 批次归组的纯函数 —— 详情图 / 商品主图 / 带货图文三页共用。
 *
 * 2026-11-03 抽取: 三个页面各自在 `utils.ts` 里写了一份逐字相同的
 * `cellState` / `batchIndexOf` / `buildRows`, 只有「行头要带哪些字段」不同。
 * 现在差异通过 `fields` 注入, 归组规则只在这里定义一次。
 */

/** 单格的展示态 */
export type CellState = 'ready' | 'pending' | 'failed';

/** 一行的公共部分: 批次标识、原图、批内产出 */
export interface BatchRowBase {
  key: string;
  createdAt?: string;
  sourceUrls: string[];
  cells: GalleryItem[];
  /** 批内还有没出图的格子 —— 决定删除按钮置灰 (生成中删会留下半套) */
  pending: boolean;
}

/** 结果卡参数摘要 (商品详情 / 商品主图共用) */
export interface ResultMeta {
  resolution?: string;
  ratio?: string;
  platform?: string;
  country?: string;
  language?: string;
}

/** 卡片布局的结果行: 商品名与参数摘要由页面归组时带出 */
export interface BatchCardRow extends BatchRowBase {
  productName?: string;
  meta?: ResultMeta;
}

/** 单格的展示态: 有图 = ready; 失败 / 取消 = failed; 其余 = pending */
export function cellState(item: GalleryItem): CellState {
  if (item.url) return 'ready';
  if (item.status === 'failed' || item.status === 'cancelled') return 'failed';
  return 'pending';
}

/** 批内顺序: batchIndex 升序; 旧任务没有该字段时保持列表原序 */
export function batchIndexOf(item: GalleryItem): number {
  const n = Number(item.params?.batchIndex);
  return Number.isFinite(n) && n > 0 ? n : Number.MAX_SAFE_INTEGER;
}

/** 行头时间: 本地时区 `YYYY-MM-DD HH:mm`; 无值或解析失败返回空串 */
export function formatBatchDate(iso?: string): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * 把任务列表归成批次行。
 *
 * @param items  结果列表, 顺序即后端返回顺序
 * @param fields 每行要额外携带的字段 (由调用方按页面语义决定)
 * @param keyOf  批次键; 没有 batchId 的旧任务按任务 id 各自成行
 */
export function buildBatchRows<Extra>(
  items: GalleryItem[],
  fields: (item: GalleryItem) => Extra,
  keyOf: (item: GalleryItem) => string,
): Array<BatchRowBase & Extra> {
  const rows: Array<BatchRowBase & Extra> = [];
  const byBatch = new Map<string, BatchRowBase & Extra>();
  for (const item of items) {
    const key = keyOf(item);
    let row = byBatch.get(key);
    if (!row) {
      row = {
        key,
        createdAt: item.createdAt,
        sourceUrls: [...(item.inputUrls ?? [])],
        cells: [],
        pending: false,
        ...fields(item),
      };
      byBatch.set(key, row);
      rows.push(row);
    }
    if (row.sourceUrls.length === 0 && item.inputUrls?.length) {
      row.sourceUrls = [...item.inputUrls];
    }
    row.cells.push(item);
  }
  for (const row of rows) {
    row.cells.sort((a, b) => batchIndexOf(a) - batchIndexOf(b));
    row.pending = row.cells.some((item) => cellState(item) === 'pending');
  }
  return rows;
}

/* ------------------------------------------------------------------------- */
/* 结果卡展示口径 (商品详情 / 商品主图共用)                                  */
/* ------------------------------------------------------------------------- */

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

function optionLabel(
  options: Array<{ value: string | number; label: string }>,
  value?: string,
): string | undefined {
  if (!value) return undefined;
  return options.find((option) => String(option.value) === value)?.label ?? value;
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

/** 结果行数（一次生成 = 一行），供页签角标使用 */
export function countGenerations(items: GalleryItem[]): number {
  return new Set(items.map(rowKeyOf)).size;
}

/**
 * 下载文件名: `<前缀>-<格名>-<任务 id 尾 6 位>.<真实格式>`。
 *
 * 扩展名跟真实格式走：厂商链接常常没有后缀，猜后缀会把 PNG 存成 .jpg。
 */
export function downloadFileName(
  item: GalleryItem,
  label: string,
  prefix: string,
): string {
  const ext = (item.format || 'png').toLowerCase().replace(/^\./, '') || 'png';
  return `${prefix}-${label}-${item.id.slice(-6)}.${ext}`;
}

/** 商品图批次行：主图 / 详情图共用同一份字段口径 */
export interface ProductBatchRow extends BatchRowBase {
  prompt?: string;
  productName?: string;
  /** 结果卡第二行展示的任务参数；同批次内各任务共用一份 */
  meta: ResultMeta;
}

/** 按 batchId 归组商品图批次（主图 / 详情图字段完全一致） */
export function buildProductBatchRows(items: GalleryItem[]): ProductBatchRow[] {
  return buildBatchRows<Omit<ProductBatchRow, keyof BatchRowBase>>(
    items,
    (item) => ({
      prompt: textParam(item, 'description'),
      productName: textParam(item, 'productName'),
      meta: resultMetaOf(item),
    }),
    rowKeyOf,
  ) as ProductBatchRow[];
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
