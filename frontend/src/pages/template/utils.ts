/**
 * 写真模板页面的纯函数与外部工具入口 —— 目录内文件的唯一外部工具来源。
 *
 * 约定：`template/` 下的文件不从 `src/lib/*` 直接取东西，一律经由本文件。
 */

/** 缩略图地址换算 */
export { assetThumbUrl } from '../../lib/api';
/** 提交失败是否「结果不明」（5xx / 网络中断）—— 与带货图文页共用 */
export { isUncertainSubmitError } from '../../lib/generateSubmit';

import type { GalleryItem } from './hooks';
import type { TemplateCatalogCategory } from './api';

/** 展平后的模板条目：带上所属一级/二级分类，供网格与历史回显使用。 */
export interface TemplateEntry {
  id: string;
  name: string;
  thumbFile: string;
  tags: string[];
  categoryId: string;
  categoryName: string;
  groupId: string;
  groupName: string;
}

/** 把分类树展平成一维模板列表。 */
export function flattenCatalog(categories: readonly TemplateCatalogCategory[]): TemplateEntry[] {
  return categories.flatMap((category) =>
    category.groups.flatMap((group) =>
      group.items.map((item) => ({
        ...item,
        categoryId: category.id,
        categoryName: category.name,
        groupId: group.id,
        groupName: group.name,
      })),
    ),
  );
}

/**
 * 按一级/二级分类筛选。
 *
 * `categoryId` 为空 = 全部模板；`groupId` 为空 = 该一级分类下的全部分组。
 */
export function filterCatalog(
  categories: readonly TemplateCatalogCategory[],
  categoryId: string,
  groupId: string,
): TemplateEntry[] {
  if (!categoryId) return flattenCatalog(categories);
  const category = categories.find((item) => item.id === categoryId);
  if (!category) return [];
  const groups = groupId
    ? category.groups.filter((group) => group.id === groupId)
    : category.groups;
  return groups.flatMap((group) =>
    group.items.map((item) => ({
      ...item,
      categoryId: category.id,
      categoryName: category.name,
      groupId: group.id,
      groupName: group.name,
    })),
  );
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
