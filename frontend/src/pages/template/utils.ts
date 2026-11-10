/**
 * 写真模板页面的纯函数与外部工具入口 —— 目录内文件的唯一外部工具来源。
 *
 * 约定：`template/` 下的文件不从 `src/lib/*` 直接取东西，一律经由本文件。
 */

/** 缩略图地址换算 */
export { assetThumbUrl } from '../../lib/api';

import type { GalleryItem } from './hooks';

/**
 * 按分类筛选模板。
 *
 * `categoryId` 为空表示「全部模板」—— 页面级筛选态，不来自后端。
 * 一个模板可跨分类，命中任一即入选。
 */
export function filterTemplatesByCategory<T extends { categoryIds: readonly string[] }>(
  templates: readonly T[],
  categoryId: string,
): T[] {
  if (!categoryId) return [...templates];
  return templates.filter((template) => template.categoryIds.includes(categoryId));
}

/** 任务参数里的模板 id（历史卡片据此回显模板名）。 */
export function templateIdOf(item: GalleryItem): string | undefined {
  const value = item.params?.templateId;
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/** 生成中 / 失败格子的文案。 */
export function emptyResultLabel(item: GalleryItem): string {
  if (item.status === 'failed') return '失败';
  if (item.status === 'cancelled') return '已取消';
  return '生成中';
}
