/**
 * 写真模板后台管理的纯函数。
 */
import type { CategoryDraft, GroupDraft, ItemDraft } from './constants';

export function parseTagInput(raw: string): string[] {
  return [
    ...new Set(
      raw
        .split(/[,，、\s]+/)
        .map((tag) => tag.trim())
        .filter(Boolean)
        .slice(0, 8),
    ),
  ];
}

export function parseSortOrder(raw: string): number {
  const value = Math.trunc(Number(raw));
  return Number.isFinite(value) ? value : 0;
}

export interface PayloadResult<T> {
  ok: boolean;
  error?: string;
  value?: T;
}

export function buildCategoryPayload(
  draft: CategoryDraft,
): PayloadResult<{
  slug: string;
  name: string;
  sourceUrl: string;
  description: string;
  sortOrder: number;
  enabled: boolean;
}> {
  const slug = draft.slug.trim();
  const name = draft.name.trim();
  if (!/^[a-z0-9][a-z0-9-]{1,39}$/.test(slug)) {
    return { ok: false, error: 'slug 只能是小写字母/数字/短横线，长度 2~40' };
  }
  if (!name) return { ok: false, error: '请填写分类名称' };
  return {
    ok: true,
    value: {
      slug,
      name,
      sourceUrl: draft.sourceUrl.trim(),
      description: draft.description.trim(),
      sortOrder: parseSortOrder(draft.sortOrder),
      enabled: draft.enabled,
    },
  };
}

export function buildGroupPayload(
  draft: GroupDraft,
): PayloadResult<{
  slug: string;
  name: string;
  sortOrder: number;
  enabled: boolean;
}> {
  const slug = draft.slug.trim();
  const name = draft.name.trim();
  if (!/^[a-z0-9][a-z0-9-]{1,39}$/.test(slug)) {
    return { ok: false, error: 'slug 只能是小写字母/数字/短横线，长度 2~40' };
  }
  if (!name) return { ok: false, error: '请填写分组名称' };
  return {
    ok: true,
    value: { slug, name, sortOrder: parseSortOrder(draft.sortOrder), enabled: draft.enabled },
  };
}

export function buildItemPayload(
  draft: ItemDraft,
): PayloadResult<{
  name: string;
  prompt: string;
  imageUrl: string;
  tags: string[];
  sortOrder: number;
  enabled: boolean;
}> {
  const name = draft.name.trim();
  const prompt = draft.prompt.trim();
  const imageUrl = draft.imageUrl.trim();
  if (!name) return { ok: false, error: '请填写模板名称' };
  if (!prompt) return { ok: false, error: '请填写模板提示词' };
  if (!imageUrl) return { ok: false, error: '请上传或填写模板图片' };
  return {
    ok: true,
    value: {
      name,
      prompt,
      imageUrl,
      tags: parseTagInput(draft.tags),
      sortOrder: parseSortOrder(draft.sortOrder),
      enabled: draft.enabled,
    },
  };
}
