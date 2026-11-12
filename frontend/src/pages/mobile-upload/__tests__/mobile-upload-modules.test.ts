import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { auditNamedImports, PROJECT_ROOT } from '../../../test/namedImportAudit';
import { MAX_FILES, MAX_TOTAL_BYTES, MAX_TOTAL_MB } from '../constants';

/**
 * 手机上传页面的具名导入对账与上传上限口径。
 */

const ROOTS = ['src/pages/mobile-upload', 'src/components', 'src/hooks', 'src/lib', 'src/context'];

describe('手机上传页具名导入', () => {
  it('每条相对导入的名字都能在目标模块里找到', () => {
    const roots = ROOTS.map((root) => resolve(PROJECT_ROOT, root));
    expect(auditNamedImports(roots)).toEqual([]);
  });
});

describe('手机上传页常量', () => {
  it('张数与整批体积上限与后端一致', () => {
    expect(MAX_FILES).toBe(9);
    expect(MAX_TOTAL_MB).toBe(60);
    expect(MAX_TOTAL_BYTES).toBe(MAX_TOTAL_MB * 1024 * 1024);
  });
});
