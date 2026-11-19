import { describe, expect, it } from 'vitest';

import {
  formatCompactDateTime,
  formatDate,
  formatRelativeTime,
} from '../format';

describe('formatDate', () => {
  it('日期固定补齐月与日，无法解析时回落到调用方文案', () => {
    expect(formatDate('2026-11-03T12:00:00')).toBe('2026/11/03');
    expect(formatDate('not-a-date', '暂无')).toBe('暂无');
  });
});

describe('formatCompactDateTime', () => {
  it('默认省略年份，并按需求切换日期段分隔符', () => {
    expect(formatCompactDateTime('2026-11-03T14:30:00')).toBe('11/03 14:30');
    expect(
      formatCompactDateTime('2026-11-03T14:30:00', { withYear: true, separator: '-' }),
    ).toBe('2026-11-03 14:30');
    expect(formatCompactDateTime(undefined, { fallback: '' })).toBe('');
  });
});

describe('formatRelativeTime', () => {
  const now = Date.UTC(2026, 10, 19, 12, 0, 0);
  const isoBefore = (ms: number) => new Date(now - ms).toISOString();

  it('按分钟、小时和日期三个档位输出相对时间', () => {
    expect(formatRelativeTime(isoBefore(30_000), '', now)).toBe('刚刚');
    expect(formatRelativeTime(isoBefore(3 * 60_000), '', now)).toBe('3 分钟前');
    expect(formatRelativeTime(isoBefore(5 * 60 * 60_000), '', now)).toBe('5 小时前');
    expect(formatRelativeTime(isoBefore(3 * 24 * 60 * 60_000), '', now)).toBe('11 月 16 日');
  });

  it('空值与无效值使用 fallback', () => {
    expect(formatRelativeTime(null, '未知', now)).toBe('未知');
    expect(formatRelativeTime('not-a-date', '未知', now)).toBe('未知');
  });
});
