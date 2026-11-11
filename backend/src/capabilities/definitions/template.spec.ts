import { describe, expect, it } from 'vitest';

import { Template } from './template';
import {
  PORTRAIT_TEMPLATES,
  TEMPLATE_CATEGORIES,
  portraitTemplate,
} from './template.templates';

const WEDDING_TEMPLATE = PORTRAIT_TEMPLATES[0];

describe('template 模板数据', () => {
  it('模板 id 唯一、分类合法，且每项都有预览图与提示词', () => {
    const ids = new Set(PORTRAIT_TEMPLATES.map((template) => template.id));
    const categoryIds = new Set(TEMPLATE_CATEGORIES.map((category) => category.id));

    expect(ids.size).toBe(PORTRAIT_TEMPLATES.length);
    for (const template of PORTRAIT_TEMPLATES) {
      expect(template.categoryIds.length).toBeGreaterThan(0);
      template.categoryIds.forEach((id) => expect(categoryIds.has(id)).toBe(true));
      expect(template.prompt.trim().length).toBeGreaterThan(0);
      expect(template.thumbFile).toMatch(/^\/templates\/wedding\/.+\.webp$/);
    }
  });

  it('按 id 查模板，未知 id 返回 undefined', () => {
    expect(portraitTemplate(WEDDING_TEMPLATE.id)).toBe(WEDDING_TEMPLATE);
    expect(portraitTemplate('not-exists')).toBeUndefined();
    expect(portraitTemplate('')).toBeUndefined();
  });

  it('包含 30 套模板，三批来源各 10 套且提示词互不重复', () => {
    expect(PORTRAIT_TEMPLATES).toHaveLength(30);
    for (const prefix of ['longfeng-', 'flower-', 'campus-']) {
      const batch = PORTRAIT_TEMPLATES.filter((template) => template.id.startsWith(prefix));
      expect(batch).toHaveLength(10);
      expect(new Set(batch.map((template) => template.prompt)).size).toBe(10);
      batch.forEach((template) => {
        expect(template.prompt.length).toBeGreaterThan(100);
        expect(template.thumbFile).toContain(`/templates/wedding/${prefix}`);
      });
    }
  });

  it('每个模板只归属一个一级分类', () => {
    const categoryIds = new Set(TEMPLATE_CATEGORIES.map((category) => category.id));

    for (const template of PORTRAIT_TEMPLATES) {
      expect(template.categoryIds).toHaveLength(1);
      template.categoryIds.forEach((id) => expect(categoryIds.has(id)).toBe(true));
    }
    expect([...new Set(PORTRAIT_TEMPLATES.flatMap((t) => t.categoryIds))].sort()).toEqual([
      'campus',
      'wedding',
    ]);
  });
});

describe('template 提示词', () => {
  it('模板名与风格描述进入提示词，并要求保持人物身份', () => {
    const prompt = Template.buildPrompt(
      { templateId: WEDDING_TEMPLATE.id, ratio: '3:4', size: '2k' },
      1,
    );

    expect(prompt).toContain(`采用「${WEDDING_TEMPLATE.name}」模板`);
    expect(prompt).toContain(WEDDING_TEMPLATE.prompt);
    expect(prompt).toContain('保持五官、脸型、发型、肤色与体型特征一致，不换人、不改变身份');
    expect(prompt).toContain('画面比例 3:4');
    expect(prompt).toContain('输出规格 2K');
  });

  it('多张参考图时说明实际照片数量', () => {
    const prompt = Template.buildPrompt({ templateId: WEDDING_TEMPLATE.id }, 3);
    expect(prompt).toContain('上传的 3 张照片');
    expect(prompt).not.toContain('上传的 1 张照片');
  });

  it('未知模板回落到通用婚纱描述，而不是空提示词', () => {
    const prompt = Template.buildPrompt({ templateId: 'not-exists' }, 1);

    expect(prompt).toContain('「婚纱写真」模板');
    expect(prompt).toContain('自然光婚纱写真');
    expect(prompt.length).toBeGreaterThan(50);
  });
});
