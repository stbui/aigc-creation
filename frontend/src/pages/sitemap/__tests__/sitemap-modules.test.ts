import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { auditNamedImports, PROJECT_ROOT } from '../../../test/namedImportAudit';
import { SECTIONS } from '../constants';
import { filterVisibleSections } from '../utils';

/**
 * 网站地图页面的具名导入对账与可见性过滤口径。
 */

const ROOTS = ['src/pages/sitemap', 'src/components', 'src/hooks', 'src/lib', 'src/context'];

describe('网站地图页具名导入', () => {
  it('每条相对导入的名字都能在目标模块里找到', () => {
    const roots = ROOTS.map((root) => resolve(PROJECT_ROOT, root));
    expect(auditNamedImports(roots)).toEqual([]);
  });
});

describe('网站地图页纯函数', () => {
  it('能力清单未到达时保留全部分组', () => {
    expect(filterVisibleSections(SECTIONS, undefined)).toHaveLength(SECTIONS.length);
  });

  it('能力清单到达后隐藏下线能力并丢掉空分组', () => {
    const items = [
      {
        id: 'main_image',
        runtime: { enabled: true, remoteAvailable: true, effective: 'remote', reason: '' },
      },
    ];
    const sections = filterVisibleSections(
      SECTIONS,
      items as Parameters<typeof filterVisibleSections>[1],
    );
    const tools = sections.find((section) => section.no === '02');
    expect(tools).toBeUndefined();
    const start = sections.find((section) => section.no === '01');
    expect(start?.links.map((link) => link.capability ?? link.name)).toContain('main_image');
    expect(start?.links.some((link) => link.capability === 'detail_image')).toBe(false);
  });
});
