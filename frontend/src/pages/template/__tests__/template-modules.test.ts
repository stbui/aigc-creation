import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { auditNamedImports, PROJECT_ROOT } from '../../../test/namedImportAudit';
import { emptyResultLabel, filterCatalog, flattenCatalog, templateIdOf } from '../utils';
import type { GalleryItem } from '../hooks';
import type { TemplateCatalogCategory } from '../api';
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
  const item = (id: string) => ({
    id,
    name: `模板 ${id}`,
    thumbFile: `/templates/${id}.webp`,
    tags: ['标签'],
  });
  const catalog: TemplateCatalogCategory[] = [
    {
      id: 'longfeng',
      slug: 'longfeng',
      name: '龙凤褂',
      description: '',
      sourceUrl: 'https://example.com/longfeng',
      groups: [
        { id: 'studio', slug: 'studio', name: '纯色棚拍', items: [item('a'), item('b')] },
        { id: 'interior', slug: 'interior', name: '室内布景', items: [item('c')] },
      ],
    },
    {
      id: 'flower',
      slug: 'flower',
      name: '花海婚纱',
      description: '',
      sourceUrl: 'https://example.com/flower',
      groups: [{ id: 'lawn', slug: 'lawn', name: '草坪花海', items: [item('d')] }],
    },
  ];

  it('展平时补齐一级/二级分类信息', () => {
    const flat = flattenCatalog(catalog);
    expect(flat.map((entry) => entry.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(flat[0]).toMatchObject({ categoryName: '龙凤褂', groupName: '纯色棚拍' });
  });

  it('一级分类为空 = 全部模板', () => {
    expect(filterCatalog(catalog, '', '')).toHaveLength(4);
  });

  it('按一级分类 / 二级分类逐层筛选，且不修改入参', () => {
    const before = catalog.map((category) => category.id);
    expect(filterCatalog(catalog, 'longfeng', '').map((entry) => entry.id)).toEqual([
      'a',
      'b',
      'c',
    ]);
    expect(filterCatalog(catalog, 'longfeng', 'studio').map((entry) => entry.id)).toEqual([
      'a',
      'b',
    ]);
    expect(filterCatalog(catalog, 'longfeng', 'missing')).toEqual([]);
    expect(filterCatalog(catalog, 'missing', '')).toEqual([]);
    expect(catalog.map((category) => category.id)).toEqual(before);
  });

  it('模板 id 只从字符串参数里取', () => {
    const task = {
      id: 'task-1',
      url: '',
      params: { templateId: ' longfeng-01 ' },
    } as GalleryItem;
    expect(templateIdOf(task)).toBe('longfeng-01');
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
