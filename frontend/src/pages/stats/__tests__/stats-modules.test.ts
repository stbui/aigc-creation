import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { auditNamedImports, PROJECT_ROOT } from '../../../test/namedImportAudit';
import { barHeightOf, trendSummaryOf, weekdayOf } from '../utils';

/**
 * 数据中心页面的具名导入对账与汇总口径。
 *
 * 与其余 C 端功能目录同因：多文件目录按分层约定拆成「入口 + 业务组件」后，
 * 一个名字写错就是整页白屏，而 Vite 把具名导入改写成属性访问 ——
 * 缺失的名字只会是 `undefined`，单文件转译与 Vitest 都不会报错。
 */

const ROOTS = ['src/pages/stats', 'src/components', 'src/hooks', 'src/lib', 'src/context'];

describe('数据中心页具名导入', () => {
  it('每条相对导入的名字都能在目标模块里找到', () => {
    const roots = ROOTS.map((root) => resolve(PROJECT_ROOT, root));
    const failures = auditNamedImports(roots);

    expect(failures).toEqual([]);
  });
});

describe('数据中心页纯函数', () => {
  const days = [
    { date: '2026-11-06', count: 0 },
    { date: '2026-11-07', count: 2 },
    { date: '2026-11-08', count: 5 },
    { date: '2026-11-09', count: 0 },
    { date: '2026-11-10', count: 1 },
    { date: '2026-11-11', count: 0 },
    { date: '2026-11-12', count: 3 },
  ];

  it('汇总总次数、峰值、活跃天数与日均', () => {
    expect(trendSummaryOf(days)).toEqual({ total: 11, peak: 5, activeDays: 4, dailyAvg: 11 / 7 });
  });

  it('柱高按峰值归一，非零值至少 4%', () => {
    expect(barHeightOf(0, 5)).toBe(0);
    expect(barHeightOf(5, 5)).toBe(100);
    expect(barHeightOf(1, 100)).toBe(4);
  });

  it('日期解析失败时不显示周几', () => {
    expect(weekdayOf('2026-11-12')).toBe('周四');
    expect(weekdayOf('not-a-date')).toBe('');
  });
});
