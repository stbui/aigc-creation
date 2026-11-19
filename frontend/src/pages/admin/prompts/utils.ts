/**
 * 提示词库的纯函数入口 —— 目录内文件的唯一纯函数来源。
 */

import { assetThumbUrl } from './api';
import type { AdminPrompt, CreatePromptPayload } from './types';
import { DEFAULT_SORT, MODALITY_LABEL, SORTABLE_FIELDS, type PromptDraft } from './constants';

export { formatDate } from '~/admin-ui/radar';

/**
 * 地址栏 `?sort=` → 表格排序值。
 *
 * 非法字段 / 方向一律退回默认排序：后端白名单会兜底，但前端若原样显示，
 * 会出现「表格没排序标记、数据却是按 sortOrder 排的」这种错位。
 */
export function parseSort(raw: string | null | undefined): string {
  const [field, dir] = String(raw ?? '').split(':');
  if (!(SORTABLE_FIELDS as readonly string[]).includes(field)) return DEFAULT_SORT;
  return `${field}:${dir === 'asc' ? 'asc' : 'desc'}`;
}

export function toDraft(prompt: AdminPrompt): PromptDraft {
  return {
    title: prompt.title,
    category: prompt.category,
    content: prompt.content,
    negativePrompt: prompt.negativePrompt,
    modality: prompt.modality,
    tags: prompt.tags.join('，'),
    images: prompt.images.map((image) => ({ ...image })),
    sortOrder: String(prompt.sortOrder),
    enabled: prompt.enabled,
  };
}

/** 标签输入兼容中英文逗号与顿号；去空白、去重、最多 8 个。 */
export function splitTags(raw: string): string[] {
  const seen = new Set<string>();
  for (const part of raw.split(/[,，、]/)) {
    const tag = part.trim().slice(0, 20);
    if (tag && !seen.has(tag)) seen.add(tag);
    if (seen.size >= 8) break;
  }
  return [...seen];
}

/**
 * 表单 → 提交体。校验失败返回文案，成功返回 payload。
 *
 * 全量提交而非只传改动项：编辑时用户可能清空某个字段（如分类、反向提示词），
 * 只传改动的字段会让「清空」变成「不修改」。
 */
export function buildPromptPayload(
  draft: PromptDraft,
): { ok: true; body: CreatePromptPayload } | { ok: false; error: string } {
  const content = draft.content.trim();
  if (!content) return { ok: false, error: '请填写提示词内容' };

  const sortOrder = Number(draft.sortOrder);
  if (!Number.isInteger(sortOrder)) return { ok: false, error: '排序必须是整数' };

  const images = draft.images.map((image) => ({
    ref: image.ref,
    ...(image.assetId ? { assetId: image.assetId } : {}),
    ...(image.name ? { name: image.name } : {}),
  }));

  return {
    ok: true,
    body: {
      title: draft.title.trim(),
      category: draft.category.trim(),
      content,
      negativePrompt: draft.negativePrompt.trim(),
      modality: draft.modality,
      tags: splitTags(draft.tags),
      images,
      sortOrder,
      enabled: draft.enabled,
    },
  };
}

/** 列表标题：标题为空时退到正文首行摘要，避免整列空白。 */
export function promptHeading(prompt: AdminPrompt): string {
  const title = prompt.title.trim();
  if (title) return title;
  const firstLine = prompt.content.trim().split('\n')[0] ?? '';
  return firstLine || '未命名提示词';
}

/** 列表「适用模态」列文案；历史脏值按原样展示。 */
export function modalityLabel(value: string): string {
  return MODALITY_LABEL[value as keyof typeof MODALITY_LABEL] ?? value;
}

/**
 * 配图预览地址。
 *
 * 优先用接口解析好的 `previewUrl`；没有时退回 `ref` 自行拼绝对地址。
 * 缩略图走 `assetThumbUrl`（本地 /uploads 会追加 w/h，云端签名地址原样返回），
 * 与素材管理同一套规则 —— 自己拼必然在切换存储后端后失效。
 *
 * `storage://` 只能由后端解析成签名地址；解析失败（对象已删 / 后端不可用）时
 * 返回 `undefined`，调用方据此渲染「图片不可用」占位。不能退回去拼
 * `${API_BASE}/storage://…` —— 那是个必然 404 的地址，前端看不出真正原因。
 */
export function imagePreview(
  image: { ref: string; previewUrl?: string },
  size = 320,
): string | undefined {
  const url = image.previewUrl || image.ref;
  if (!url || url.startsWith('storage://')) return undefined;
  return assetThumbUrl(url, size);
}
