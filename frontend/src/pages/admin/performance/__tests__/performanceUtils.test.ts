import { describe, expect, it } from 'vitest';
import { TASK_STATUS_LABELS } from '../constants';
import {
  coolingKeyLabel,
  coolingSummary,
  countSummary,
  durationOrDash,
  eventLoopHint,
  heapUsageHint,
  heapUsagePct,
  labelOf,
  loadavgText,
  pct,
  successRateHint,
} from '../utils';

/**
 * 系统信息页的读数解释。
 *
 * 这些函数决定「同一个数字该被读成正常还是异常」，也是页面唯一会做判断的
 * 地方；阈值写错会把阻塞读成健康，所以边界值单独锁住。
 */
describe('performance utils', () => {
  it('枚举缺项时保留原值，空值给「—」', () => {
    expect(labelOf({ local: '本地磁盘' }, 'local')).toBe('本地磁盘');
    expect(labelOf({ local: '本地磁盘' }, 'unknown')).toBe('unknown');
    expect(labelOf({}, null)).toBe('—');
  });

  it('没有样本的比率与耗时显示「—」，不写 0', () => {
    expect(pct(null)).toBe('—');
    expect(pct(0.95)).toBe('95.0%');
    expect(durationOrDash(null)).toBe('—');
    expect(durationOrDash(4321)).toBe('4.3s');
  });

  it('负载均值带单位说明，平台缺失时说明原因', () => {
    expect(loadavgText([])).toBe('当前平台不提供');
    expect(loadavgText([0.12, 0.34, 0.56])).toBe('0.12 / 0.34 / 0.56（1 / 5 / 15 分钟）');
  });

  it('分布按数量降序，状态用统一术语', () => {
    expect(countSummary({ failed: 5, succeeded: 95 }, TASK_STATUS_LABELS)).toBe(
      '已完成 95 · 失败 5',
    );
    expect(countSummary({}, TASK_STATUS_LABELS)).toBe('—');
  });

  it('堆使用率不做除零，并在阈值边界给出结论', () => {
    expect(heapUsagePct(0, 0)).toBe(0);
    expect(heapUsagePct(50, 200)).toBe(25);
    expect(heapUsageHint(74)).toEqual({});
    expect(heapUsageHint(75)).toEqual({ tone: 'warn', hint: '偏高' });
    expect(heapUsageHint(90)).toEqual({ tone: 'danger', hint: '接近上限' });
  });

  it('事件循环延迟在阈值边界上给出正确结论', () => {
    expect(eventLoopHint(20)).toEqual({});
    expect(eventLoopHint(21)).toEqual({ tone: 'warn', hint: '偏高' });
    expect(eventLoopHint(100)).toEqual({ tone: 'warn', hint: '偏高' });
    expect(eventLoopHint(101)).toEqual({ tone: 'danger', hint: '阻塞明显' });
  });

  it('成功率在阈值边界上给出正确结论，无样本不判定', () => {
    expect(successRateHint(null)).toEqual({});
    expect(successRateHint(0.98)).toEqual({});
    expect(successRateHint(0.9)).toEqual({ tone: 'warn', hint: '偏低' });
    expect(successRateHint(0.89)).toEqual({ tone: 'danger', hint: '异常' });
  });

  it('冷却键拆成可读对象并保留 id，解封时间同屏给出', () => {
    expect(coolingKeyLabel('channel:abc')).toBe('渠道（abc）');
    expect(coolingKeyLabel('channel-model:def')).toBe('渠道模型（def）');
    expect(coolingKeyLabel('route')).toBe('线路');
    // 未登记的前缀原样保留，不吞掉这个键
    expect(coolingKeyLabel('other:xyz')).toBe('other（xyz）');
    expect(coolingSummary([{ key: 'channel:abc', until: '2026-11-26T10:30:00.000Z' }])).toBe(
      '渠道（abc）至 11-26 18:30',
    );
    expect(coolingSummary([{ key: 'channel:abc', until: 'not-a-date' }])).toBe(
      '渠道（abc） 解封时间未知',
    );
  });
});
