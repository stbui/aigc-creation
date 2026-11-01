import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { auditNamedImports, PROJECT_ROOT } from '../../../test/namedImportAudit';

/**
 * 创意生图页面的具名导入 / 导出对账。
 *
 * 与 `product-detail` / `product-kit` / `viral-clone` 同因：多文件功能目录按分层
 * 约定拆成「入口文件 + 业务组件」后，一个名字写错就是整页白屏，而 Vite 把具名
 * 导入改写成属性访问，缺失的名字只会是 `undefined` —— 单文件转译与 Vitest 都
 * 不会报错。这里直接读源码对账。
 *
 * 判据实现与后台 / 其余 C 端目录共用 `src/test/namedImportAudit.ts`。
 */

const ROOTS = [
  'src/pages/creative-image',
  'src/components',
  'src/hooks',
  'src/lib',
  'src/context',
];

describe('创意生图页具名导入', () => {
  it('每条相对导入的名字都能在目标模块里找到', () => {
    const roots = ROOTS.map((root) => resolve(PROJECT_ROOT, root));
    const failures = auditNamedImports(roots);

    expect(failures).toEqual([]);
  });
});
