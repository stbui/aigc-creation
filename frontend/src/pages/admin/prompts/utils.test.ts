import { describe, expect, it } from 'vitest';

import {
  buildPromptPayload,
  imagePreview,
  parseSort,
  promptHeading,
  splitTags,
  toDraft,
} from './utils';
import type { AdminPrompt } from './types';

describe('提示词配图预览地址', () => {
  it('storage:// 引用解析不出地址时返回 undefined，交给调用方渲染占位', () => {
    // 后端解析失败（对象已删 / 后端不可用）时 previewUrl 为空串。
    // 不能退回拼 `${API_BASE}/storage://...` —— 那是个必然 404 的地址。
    expect(imagePreview({ ref: 'storage://local/prompts/a.jpg' })).toBeUndefined();
    expect(imagePreview({ ref: 'storage://local/prompts/a.jpg', previewUrl: '' })).toBeUndefined();
  });

  it('接口解析好的云端地址原样返回', () => {
    const url = 'https://cdn.example.com/prompts/a.webp';
    expect(imagePreview({ ref: 'storage://oss/prompts/a.webp', previewUrl: url })).toBe(url);
  });

  it('本地 /uploads 地址追加缩略尺寸', () => {
    const url = imagePreview({ ref: '/uploads/prompts/a.png' }, 320);
    expect(url).toContain('/uploads/prompts/a.png');
    expect(url).toContain('w=320');
    expect(url).toContain('h=320');
  });
});

describe('列表排序参数', () => {
  it('只接受白名单字段与 asc/desc，其余退回默认排序', () => {
    expect(parseSort('title:asc')).toBe('title:asc');
    expect(parseSort('updatedAt:desc')).toBe('updatedAt:desc');
    // 方向写错按降序处理，与后端 buildPage 同口径
    expect(parseSort('sortOrder:nope')).toBe('sortOrder:desc');
    // 非白名单字段（包括按 createdAt 以外的列名）不进入查询
    expect(parseSort('content:asc')).toBe('sortOrder:asc');
    expect(parseSort(null)).toBe('sortOrder:asc');
    expect(parseSort('')).toBe('sortOrder:asc');
  });
});

describe('提示词表单与列表纯函数', () => {
  const prompt: AdminPrompt = {
    id: 'p1',
    title: '  ',
    category: '',
    content: '白底商品图\n补光',
    negativePrompt: '',
    modality: 'image',
    tags: ['电商'],
    images: [{ ref: 'storage://local/prompts/a.jpg', assetId: 'a1' }],
    sortOrder: 3,
    enabled: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };

  it('标题为空时用正文首行兜底', () => {
    expect(promptHeading(prompt)).toBe('白底商品图');
    expect(promptHeading({ ...prompt, content: '  ' })).toBe('未命名提示词');
  });

  it('标签兼容中英文逗号与顿号，并去重', () => {
    expect(splitTags('电商，人像、电商, 棚拍')).toEqual(['电商', '人像', '棚拍']);
  });

  it('表单转提交体：清空的字段也要带上，排序必须是整数', () => {
    const draft = toDraft(prompt);
    const built = buildPromptPayload({ ...draft, sortOrder: '2', title: '' });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.body).toMatchObject({
      title: '',
      category: '',
      negativePrompt: '',
      sortOrder: 2,
      enabled: false,
      images: [{ ref: 'storage://local/prompts/a.jpg', assetId: 'a1' }],
    });

    expect(buildPromptPayload({ ...draft, sortOrder: '1.5' })).toEqual({
      ok: false,
      error: '排序必须是整数',
    });
    expect(buildPromptPayload({ ...draft, content: ' ' })).toEqual({
      ok: false,
      error: '请填写提示词内容',
    });
  });
});
