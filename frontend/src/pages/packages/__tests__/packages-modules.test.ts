import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { auditNamedImports, PROJECT_ROOT } from '../../../test/namedImportAudit';
import { formatPerCredit, pickBestValueId, planActionLabel } from '../utils';
import type { MembershipPlan, Product } from '../../../types/api';

/**
 * 积分商城页面的具名导入对账与定价展示口径。
 */

const ROOTS = ['src/pages/packages', 'src/components', 'src/hooks', 'src/lib', 'src/context'];

const product = (id: string, priceCents: number, credits: number) =>
  ({ id, priceCents, credits }) as Product;

const plan = (code: string, priceCents: number, durationDays = 30) =>
  ({ code, priceCents, durationDays }) as MembershipPlan;

describe('积分商城页具名导入', () => {
  it('每条相对导入的名字都能在目标模块里找到', () => {
    const roots = ROOTS.map((root) => resolve(PROJECT_ROOT, root));
    expect(auditNamedImports(roots)).toEqual([]);
  });
});

describe('积分商城页纯函数', () => {
  it('折合单价只对付费且积分大于 0 的商品生效', () => {
    expect(formatPerCredit(product('a', 1000, 2000))).toBe('¥0.0050');
    expect(formatPerCredit(product('b', 0, 2000))).toBeNull();
    expect(formatPerCredit(product('c', 1000, 0))).toBeNull();
  });

  it('至少两件付费包才标记最划算，免费包不参与', () => {
    expect(pickBestValueId([product('a', 1000, 1000)])).toBeNull();
    expect(
      pickBestValueId([product('free', 0, 500), product('a', 1000, 1000), product('b', 900, 1000)]),
    ).toBe('b');
  });

  it('会员按钮文案按当前方案与价格给出', () => {
    const basic = plan('basic', 9900);
    const pro = plan('pro', 19900);
    expect(planActionLabel(basic, null, null)).toBe('订阅');
    expect(planActionLabel(basic, 'basic', basic)).toBe('续费');
    expect(planActionLabel(basic, 'pro', pro)).toBe('切换');
    expect(planActionLabel(pro, 'basic', basic)).toBe('升级');
    expect(planActionLabel(plan('free', 0, 0), 'free', null)).toBe('当前方案');
  });
});
