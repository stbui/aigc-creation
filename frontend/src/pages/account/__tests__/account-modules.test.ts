import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { auditNamedImports, PROJECT_ROOT } from '../../../test/namedImportAudit';

/**
 * 账户中心页面的具名导入 / 导出对账。
 *
 * 与其余功能目录同因：多文件目录按分层约定拆成「入口文件 + 分层模块」后，
 * 一个名字写错就是整页白屏，而 Vite 把具名导入改写成属性访问，缺失的名字只会是
 * `undefined` —— 单文件转译与 Vitest 都不会报错。这里直接读源码对账。
 *
 * 判据实现与后台 / 其余功能目录共用 `src/test/namedImportAudit.ts`。
 */

const ROOTS = [
  'src/pages/account',
  'src/components',
  'src/hooks',
  'src/lib',
  'src/context',
];

describe('账户中心页具名导入', () => {
  it('每条相对导入的名字都能在目标模块里找到', () => {
    const roots = ROOTS.map((root) => resolve(PROJECT_ROOT, root));
    const failures = auditNamedImports(roots);

    expect(failures).toEqual([]);
  });
});
