import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { auditNamedImports, PROJECT_ROOT } from '../../../test/namedImportAudit';
import { PARAM_TEXT_MAX_LENGTH, PARAM_TEXT_ROWS } from '../constants';

/**
 * 通用工具页的具名导入对账与表单规格。
 *
 * 与其余 C 端功能目录同因：多文件目录按分层约定拆成「入口 + 业务组件」后，
 * 一个名字写错就是整页白屏，而 Vite 把具名导入改写成属性访问 ——
 * 缺失的名字只会是 `undefined`，单文件转译与 Vitest 都不会报错。
 */

const ROOTS = ['src/pages/tool', 'src/components', 'src/hooks', 'src/lib', 'src/context'];

describe('通用工具页具名导入', () => {
  it('每条相对导入的名字都能在目标模块里找到', () => {
    const roots = ROOTS.map((root) => resolve(PROJECT_ROOT, root));
    expect(auditNamedImports(roots)).toEqual([]);
  });
});

describe('通用工具页表单规格', () => {
  it('文本参数使用固定的行数与默认长度', () => {
    expect(PARAM_TEXT_ROWS).toBe(3);
    expect(PARAM_TEXT_MAX_LENGTH).toBe(500);
  });
});
