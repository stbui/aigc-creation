import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { auditNamedImports, PROJECT_ROOT } from '../../../test/namedImportAudit';
import { safeHelpImageUrl } from '../utils';

/**
 * 结算页的具名导入 / 导出对账。
 *
 * 与其余 C 端功能目录同因：多文件目录按分层约定拆成「入口文件 + 业务组件」后，
 * 一个名字写错就是整页白屏，而 Vite 把具名导入改写成属性访问，缺失的名字只会是
 * `undefined` —— 单文件转译与 Vitest 都不会报错。这里直接读源码对账。
 *
 * 判据实现与后台 / 其余 C 端目录共用 `src/test/namedImportAudit.ts`。
 */

const ROOTS = [
  'src/pages/checkout',
  'src/components',
  'src/hooks',
  'src/lib',
  'src/context',
];

describe('结算页具名导入', () => {
  it('每条相对导入的名字都能在目标模块里找到', () => {
    const roots = ROOTS.map((root) => resolve(PROJECT_ROOT, root));
    const failures = auditNamedImports(roots);

    expect(failures).toEqual([]);
  });
});

describe('帮助图片 URL', () => {
  it('只允许站内路径与 http(s) 地址', () => {
    expect(safeHelpImageUrl('/uploads/help.png')).toBe('/uploads/help.png');
    expect(safeHelpImageUrl('https://cdn.example.com/help.png')).toBe(
      'https://cdn.example.com/help.png',
    );
    expect(safeHelpImageUrl('javascript:alert(1)')).toBeNull();
    expect(safeHelpImageUrl('data:image/png;base64,abc')).toBeNull();
    expect(safeHelpImageUrl('//evil.example.com/help.png')).toBeNull();
    expect(safeHelpImageUrl('/uploads\\help.png')).toBeNull();
    expect(safeHelpImageUrl('')).toBeNull();
  });
});
