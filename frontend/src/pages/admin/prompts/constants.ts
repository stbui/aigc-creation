/**
 * 提示词库的本地常量与表单草稿。
 */

import type { PromptImage, PromptModality } from './types';

/**
 * 默认排序，与后端 `buildPage(..., 'sortOrder:asc')` 同口径。
 *
 * 只有用户改了排序才写进地址栏；默认值不占 URL，分享链接不会多一个无用参数。
 */
export const DEFAULT_SORT = 'sortOrder:asc';

/** 可排序列，与后端 `SORTABLE_FIELDS` 对齐；地址栏里的其它值按默认排序处理。 */
export const SORTABLE_FIELDS = ['sortOrder', 'createdAt', 'updatedAt', 'title'] as const;

/** 与后端 `PROMPT_IMAGES_MAX` 一致；前端只是提前拦，后端仍会校验 */
export const PROMPT_IMAGES_MAX = 9;

export const MODALITY_LABEL: Record<PromptModality, string> = {
  image: '图片',
  video: '视频',
  text: '文本',
};

export const MODALITY_OPTIONS = Object.entries(MODALITY_LABEL).map(([value, label]) => ({
  value,
  label,
}));

export const ENABLED_OPTIONS = [
  { value: 'true', label: '已启用' },
  { value: 'false', label: '已停用' },
];

export interface PromptDraft {
  /** 可留空 */
  title: string;
  category: string;
  content: string;
  negativePrompt: string;
  modality: PromptModality;
  /** 逗号分隔，提交前拆成数组 */
  tags: string;
  images: PromptImage[];
  sortOrder: string;
  enabled: boolean;
}

export const EMPTY_PROMPT_DRAFT: PromptDraft = {
  title: '',
  category: '',
  content: '',
  negativePrompt: '',
  modality: 'image',
  tags: '',
  images: [],
  sortOrder: '0',
  enabled: true,
};
