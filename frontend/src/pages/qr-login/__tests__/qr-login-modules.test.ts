import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { auditNamedImports, PROJECT_ROOT } from '../../../test/namedImportAudit';

/**
 * 扫码登录确认页的具名导入对账。
 */

const ROOTS = ['src/pages/qr-login', 'src/components', 'src/hooks', 'src/lib', 'src/context'];

describe('扫码登录确认页具名导入', () => {
  it('每条相对导入的名字都能在目标模块里找到', () => {
    const roots = ROOTS.map((root) => resolve(PROJECT_ROOT, root));
    expect(auditNamedImports(roots)).toEqual([]);
  });
});
