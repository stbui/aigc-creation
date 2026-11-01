import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { auditNamedImports, PROJECT_ROOT } from '../../../test/namedImportAudit';

/**
 * 商品主图页面的具名导入 / 导出对账。
 *
 * 与 `product-detail` 同因：多文件功能目录按分层约定拆成「入口文件 + 业务组件」
 * 后，一个名字写错就是整页白屏，而 Vite 把具名导入改写成属性访问，缺失的名字
 * 只会是 `undefined` —— 单文件转译与 Vitest 都不会报错。这里直接读源码对账。
 *
 * 判据实现与后台 / `product-detail` 共用 `src/test/namedImportAudit.ts`。
 */

const ROOTS = [
  'src/pages/product-kit',
  'src/components',
  'src/hooks',
  'src/lib',
  'src/context',
];

describe('商品主图页具名导入', () => {
  it('每条相对导入的名字都能在目标模块里找到', () => {
    const roots = ROOTS.map((root) => resolve(PROJECT_ROOT, root));
    const failures = auditNamedImports(roots);

    expect(failures).toEqual([]);
  });
});
