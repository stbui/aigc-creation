import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { auditNamedImports, PROJECT_ROOT } from '../../../test/namedImportAudit';

/**
 * 邀请有奖目录的具名导入 / 导出对账。
 *
 * 与其余功能目录同因：多文件目录按分层约定拆成「入口文件 + 分层模块」后，
 * 一个名字写错就是整页白屏。这里直接读源码对账。
 */

const ROOTS = [
  'src/pages/invitations',
  'src/components',
  'src/hooks',
  'src/lib',
  'src/context',
];

describe('邀请有奖目录具名导入', () => {
  it('每条相对导入的名字都能在目标模块里找到', () => {
    const roots = ROOTS.map((root) => resolve(PROJECT_ROOT, root));
    const failures = auditNamedImports(roots);

    expect(failures).toEqual([]);
  });
});
