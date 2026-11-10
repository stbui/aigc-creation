/**
 * 写真模板后台管理的本地常量与表单草稿。
 */
import type {
  AdminTemplateCategory,
  AdminTemplateGroup,
  AdminTemplateItem,
} from '../../../types/api';

export interface CategoryDraft {
  slug: string;
  name: string;
  sourceUrl: string;
  description: string;
  sortOrder: string;
  enabled: boolean;
}

export interface GroupDraft {
  slug: string;
  name: string;
  sortOrder: string;
  enabled: boolean;
}

export interface ItemDraft {
  name: string;
  prompt: string;
  imageUrl: string;
  previewUrl: string;
  tags: string;
  sortOrder: string;
  enabled: boolean;
}

export const EMPTY_CATEGORY: CategoryDraft = {
  slug: '',
  name: '',
  sourceUrl: '',
  description: '',
  sortOrder: '0',
  enabled: true,
};

export const EMPTY_GROUP: GroupDraft = {
  slug: '',
  name: '',
  sortOrder: '0',
  enabled: true,
};

export const EMPTY_ITEM: ItemDraft = {
  name: '',
  prompt: '',
  imageUrl: '',
  previewUrl: '',
  tags: '',
  sortOrder: '0',
  enabled: true,
};

export function toCategoryDraft(category: AdminTemplateCategory): CategoryDraft {
  return {
    slug: category.slug,
    name: category.name,
    sourceUrl: category.sourceUrl,
    description: category.description,
    sortOrder: String(category.sortOrder),
    enabled: category.enabled,
  };
}

export function toGroupDraft(group: AdminTemplateGroup): GroupDraft {
  return {
    slug: group.slug,
    name: group.name,
    sortOrder: String(group.sortOrder),
    enabled: group.enabled,
  };
}

export function toItemDraft(item: AdminTemplateItem): ItemDraft {
  return {
    name: item.name,
    prompt: item.prompt,
    imageUrl: item.imageUrl,
    previewUrl: item.thumbFile,
    tags: item.tags.join('，'),
    sortOrder: String(item.sortOrder),
    enabled: item.enabled,
  };
}
