import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ChannelModelHealthPanel } from '../ChannelModelHealthPanel';
import type { ChannelModelHealthRowView } from '../../../../types/model';

/**
 * 线路健康面板的展示口径。
 *
 * 三条不变量值得锁住：
 *   1. 「没数据」与「全失败」必须分得开 —— 成功率 null 显示「无样本」，
 *      而不是 0.0%（后者会被读成「这条线全挂了」）；
 *   2. 样本被截断时必须提示「按最近部分统计」，不能把截断后的成功率
 *      当成全窗口成功率；
 *   3. 线路停用 / 协议未注册 / 冷却中三个状态标记要与「当前状态」端点
 *      （`/admin/channels/health`）口径一致。
 */

function row(over: Partial<ChannelModelHealthRowView> = {}): ChannelModelHealthRowView {
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

function window(over: Partial<ChannelModelHealthRowView['windows']['day']> = {}) {
  return {
    samples: 0,
    success: 0,
    failed: 0,
    successRate: null,
    p95DurationMs: null,
    avgDurationMs: null,
    sampled: false,
    ...over,
  };
}

describe('ChannelModelHealthPanel', () => {
  it('没有终态样本时显示「无样本」而不是 0%', () => {
    render(<ChannelModelHealthPanel rows={[row()]} loading={false} />);

    expect(screen.getAllByText('无样本').length).toBe(2);
    // 24h 窗口提示与「最近样本」空态各一处
    expect(screen.getAllByText('暂无调用').length).toBeGreaterThanOrEqual(1);
  });

  it('成功率按语义分档展示', () => {
    render(
      <ChannelModelHealthPanel
        rows={[
          row({
            windows: {
              day: window({ samples: 10, success: 4, failed: 6, successRate: 0.4 }),
              week: window({ samples: 10, success: 10, successRate: 1 }),
            },
          }),
        ]}
        loading={false}
      />,
    );

    expect(screen.getByText('40.0%')).toBeTruthy();
    expect(screen.getByText('100.0%')).toBeTruthy();
  });

  it('样本被截断时提示「按最近部分统计」', () => {
    render(
      <ChannelModelHealthPanel
        rows={[
          row({
            windows: {
              day: window({ samples: 5, success: 5, successRate: 1, sampled: true }),
              week: window(),
            },
          }),
        ]}
        loading={false}
      />,
    );

    expect(screen.getByText(/按最近部分统计/)).toBeTruthy();
  });

  it('停用与冷却状态与当前状态端点口径一致', () => {
    render(
      <ChannelModelHealthPanel
        rows={[
          row({
            enabled: false,
            protocolKnown: false,
            coolingUntil: new Date('2026-11-01T00:00:00Z').toISOString(),
          }),
        ]}
        loading={false}
      />,
    );

    expect(screen.getByText('停用')).toBeTruthy();
    expect(screen.getByText('接口不可用')).toBeTruthy();
    expect(screen.getByText('暂时不可用')).toBeTruthy();
  });

  it('最近样本显示错误码', () => {
    render(
      <ChannelModelHealthPanel
        rows={[
          row({
            lastErrorCode: 'upstream_http_500',
            recent: [
              {
                status: 'failed',
                statusCode: 500,
                durationMs: 1200,
                errorCode: 'upstream_http_500',
                error: '上游返回 500',
                at: '2026-11-01T00:00:00.000Z',
              },
            ],
          }),
        ]}
        loading={false}
      />,
    );

    expect(screen.getByText(/最近错误 upstream_http_500/)).toBeTruthy();
  });

  it('没有任何线路时给出可操作的空态', () => {
    render(<ChannelModelHealthPanel rows={[]} loading={false} />);

    expect(screen.getByText('暂无可观测线路')).toBeTruthy();
  });
});
