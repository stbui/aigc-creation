import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { auditNamedImports, PROJECT_ROOT } from '../../../test/namedImportAudit';

/**
 * 局部重绘页面的具名导入 / 导出对账。
 *
 * 本页除了分层入口, 还有自己的画布组件 `MaskPainter` —— 页面与画布之间的
 * 类型、句柄与工具函数一旦写错名字, 同样只会在浏览器里表现为整页白屏。
 * 这里直接读源码核对每个相对导入的名字。
 *
 * 判据实现与后台 / 其余 C 端目录共用 `src/test/namedImportAudit.ts`。
 */

const ROOTS = [
  'src/pages/local-redraw',
  'src/components',
  'src/hooks',
  'src/lib',
  'src/context',
];

describe('局部重绘页具名导入', () => {
  it('每条相对导入的名字都能在目标模块里找到', () => {
    const roots = ROOTS.map((root) => resolve(PROJECT_ROOT, root));
    const failures = auditNamedImports(roots);

    expect(failures).toEqual([]);
  });
});
