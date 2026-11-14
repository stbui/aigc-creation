import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { auditNamedImports, PROJECT_ROOT } from '../../../test/namedImportAudit';
import { ledgerFilterParams, ledgerReference, ledgerRemark, shortId } from '../utils';
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

describe('关联单据展示口径', () => {
  it('短 ID 取末 8 位', () => {
    expect(shortId('abcdefghijklmnop')).toBe('ijklmnop');
  });

  it('生成账单 > 支付订单 > 生成任务，都没有时返回 null', () => {
    const base = {
      billingOrderId: null,
      paymentOrderId: null,
      taskId: null,
    } as CreditLedgerEntry;
    expect(ledgerReference(base)).toBeNull();
    expect(ledgerReference({ ...base, taskId: 'task-1' } as CreditLedgerEntry)).toEqual({
      label: '生成任务',
      id: 'task-1',
    });
    expect(
      ledgerReference({ ...base, paymentOrderId: 'pay-1', taskId: 'task-1' } as CreditLedgerEntry),
    ).toEqual({ label: '支付订单', id: 'pay-1' });
    expect(
      ledgerReference({ ...base, billingOrderId: 'bill-1', paymentOrderId: 'pay-1' } as CreditLedgerEntry),
    ).toEqual({ label: '生成账单', id: 'bill-1' });
  });
});
