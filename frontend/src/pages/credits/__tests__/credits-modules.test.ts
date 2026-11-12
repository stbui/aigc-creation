import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { auditNamedImports, PROJECT_ROOT } from '../../../test/namedImportAudit';
import { ledgerFilterParams, ledgerRemark } from '../utils';
import type { CreditLedgerEntry } from '../../../types/api';

/**
 * 积分明细页面的具名导入对账与流水口径。
 *
 * 与其余 C 端功能目录同因：多文件目录按分层约定拆成「入口 + 业务组件」后，
 * 一个名字写错就是整页白屏，而 Vite 把具名导入改写成属性访问 ——
 * 缺失的名字只会是 `undefined`，单文件转译与 Vitest 都不会报错。
 */

const ROOTS = ['src/pages/credits', 'src/components', 'src/hooks', 'src/lib', 'src/context'];

describe('积分明细页具名导入', () => {
  it('每条相对导入的名字都能在目标模块里找到', () => {
    const roots = ROOTS.map((root) => resolve(PROJECT_ROOT, root));
    const failures = auditNamedImports(roots);

    expect(failures).toEqual([]);
  });
});

describe('积分流水口径', () => {
  it('筛选项映射到后端参数', () => {
    expect(ledgerFilterParams('all')).toEqual({});
    expect(ledgerFilterParams('income')).toEqual({ direction: 'income' });
    expect(ledgerFilterParams('expense')).toEqual({ direction: 'expense' });
    expect(ledgerFilterParams('consume')).toEqual({ type: 'consume' });
  });

  it('客服调整不透出后台备注，其余类型保留原因', () => {
    expect(
      ledgerRemark({ type: 'admin_adjust', reason: '工单 #123 客服小王' } as CreditLedgerEntry),
    ).toBe('客服调整');
    expect(
      ledgerRemark({ type: 'consume', reason: '生成消耗' } as CreditLedgerEntry),
    ).toBe('生成消耗');
    expect(ledgerRemark({ type: 'consume', reason: null } as CreditLedgerEntry)).toBeNull();
  });
});
