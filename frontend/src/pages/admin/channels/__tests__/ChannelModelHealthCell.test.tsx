import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ChannelModelHealthCell } from '../ChannelModelHealthCell';
import { formatRate, healthTone } from '../utils';
import type { ChannelModelHealthRowView } from '../../../../types/model';

/**
 * 稳定性单元格的展示口径。
 *
 * 锁住三条不变量：
 *   1. **「没调用过」不算不健康** —— 无样本时显示「无调用」（完整说明
 *      「近 24 小时」在 tooltip），而不是 0%（后者会被读成「这条线全挂了」）；
 *   2. 成功率分档：≥95% 成功 / ≥80% 警告 / 其余危险；
 *   3. 接近 100% 时不显示小数尾巴（99.5% 而不是 99.50%）。
 */

function health(over: Partial<ChannelModelHealthRowView> = {}): ChannelModelHealthRowView {
  return {
    id: 'm1',
    channelId: 'c1',
    channelName: '系统渠道',
    name: '示例线路',
    capability: 'image',
    enabled: true,
    protocolKnown: true,
    coolingUntil: null,
    windows: {
      day: {
        samples: 0,
        success: 0,
        failed: 0,
        successRate: null,
        p95DurationMs: null,
        avgDurationMs: null,
        sampled: false,
      },
      week: {
        samples: 0,
        success: 0,
        failed: 0,
        successRate: null,
        p95DurationMs: null,
        avgDurationMs: null,
        sampled: false,
      },
    },
    recent: [],
    lastErrorCode: '',
    ...over,
  };
}

describe('healthTone', () => {
  it('按成功率分档', () => {
    expect(healthTone(1, 10)).toBe('success');
    expect(healthTone(0.95, 10)).toBe('success');
    expect(healthTone(0.9, 10)).toBe('warn');
    expect(healthTone(0.85, 10)).toBe('warn');
    expect(healthTone(0.4, 10)).toBe('danger');
  });

  it('无样本或 null 率为中性', () => {
    expect(healthTone(null, 0)).toBe('muted');
    expect(healthTone(0.4, 0)).toBe('muted');
  });
});

describe('formatRate', () => {
  it('恰好 100% 时不显示小数尾巴', () => {
    expect(formatRate(1)).toBe('100%');
    expect(formatRate(0)).toBe('0%');
  });

  it('99.5% 不能显示成 100%（会把偶发失败说成从未失败）', () => {
    expect(formatRate(0.995)).toBe('99.5%');
  });

  it('常规值保留一位小数', () => {
    expect(formatRate(0.876)).toBe('87.6%');
  });

  it('null 显示「—」', () => {
    expect(formatRate(null)).toBe('—');
  });
});

describe('ChannelModelHealthCell', () => {
  it('无样本时显示「无调用」而不是 0%', () => {
    render(<ChannelModelHealthCell health={health()} />);
    expect(screen.getByText('无调用')).toBeTruthy();
  });

  it('有样本时显示成功率与次数', () => {
    render(
      <ChannelModelHealthCell
        health={health({
          windows: {
            day: {
              samples: 10,
              success: 9,
              failed: 1,
              successRate: 0.9,
              p95DurationMs: 1200,
              avgDurationMs: 800,
              sampled: false,
            },
            week: health().windows.week,
          },
        })}
      />,
    );
    expect(screen.getByText('90.0%')).toBeTruthy();
    expect(screen.getByText('10 次')).toBeTruthy();
  });

  it('没有任何健康数据时也给出可读文案', () => {
    render(<ChannelModelHealthCell />);
    expect(screen.getByText('无调用')).toBeTruthy();
  });
});
