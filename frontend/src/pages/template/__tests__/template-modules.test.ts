import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { auditNamedImports, PROJECT_ROOT } from '../../../test/namedImportAudit';
import { emptyResultLabel, filterTemplatesByCategory, templateIdOf } from '../utils';
import type { GalleryItem } from '../hooks';
import { CAPABILITY_ID, DEFAULT_RATIO, DEFAULT_SIZE, MAX_IMAGES } from '../constants';

/**
 * 写真模板页面的模块对账与纯函数口径。
 *
 * 与其余 C 端功能目录同因：多文件目录按分层约定拆成「入口 + 业务组件」后，
 * 一个名字写错就是整页白屏，而 Vite 把具名导入改写成属性访问 ——
 * 缺失的名字只会是 `undefined`，单文件转译不会报错。这里直接读源码对账。
 */

const ROOTS = [
  'src/pages/template',
  'src/components',
  'src/hooks',
  'src/lib',
  'src/context',
];

describe('写真模板页具名导入', () => {
  it('每条相对导入的名字都能在目标模块里找到', () => {
    const roots = ROOTS.map((root) => resolve(PROJECT_ROOT, root));
    const failures = auditNamedImports(roots);

    expect(failures).toEqual([]);
  });
});

describe('写真模板页纯函数', () => {
  const templates = [
    { id: 'a', categoryIds: ['wedding'] },
    { id: 'b', categoryIds: ['wedding', 'other'] },
    { id: 'c', categoryIds: ['other'] },
  ];

  it('空分类 = 全部模板', () => {
    expect(filterTemplatesByCategory(templates, '')).toHaveLength(3);
  });

  it('跨分类模板命中任一分类即入选，且不修改入参', () => {
    const before = templates.map((template) => template.id);
    expect(filterTemplatesByCategory(templates, 'other').map((template) => template.id)).toEqual([
      'b',
      'c',
    ]);
    expect(templates.map((template) => template.id)).toEqual(before);
  });

  it('模板 id 只从字符串参数里取', () => {
    const item = {
      id: 'task-1',
      url: '',
      params: { templateId: ' longfeng-01 ' },
    } as GalleryItem;
    expect(templateIdOf(item)).toBe('longfeng-01');
    expect(templateIdOf({ id: 'task-2', url: '', params: {} } as GalleryItem)).toBeUndefined();
  });

  it('无图格子按任务状态给出真实文案', () => {
    expect(emptyResultLabel({ id: '1', url: '', status: 'failed' } as GalleryItem)).toBe('失败');
    expect(emptyResultLabel({ id: '2', url: '', status: 'cancelled' } as GalleryItem)).toBe(
      '已取消',
    );
    expect(emptyResultLabel({ id: '3', url: '', status: 'running' } as GalleryItem)).toBe('生成中');
  });

  it('页面常量与后端声明的输入上限一致', () => {
    expect(CAPABILITY_ID).toBe('template');
    expect(MAX_IMAGES).toBe(5);
    expect(DEFAULT_RATIO).toBe('3:4');
    expect(DEFAULT_SIZE).toBe('2k');
  });
});
