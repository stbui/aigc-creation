import { useMemo } from 'react';
import { AdminDataTable, type AdminColumn } from '../../../admin-ui/primitives/DataTable';
import { HoverTip } from '../../../admin-ui/controls';
import { StatusTag } from '../../../components/admin/PageHeader';
import type { ChannelModelHealthRowView } from '../../../types/model';

/**
 * 线路健康面板：一条渠道模型一行，给 24h / 7d 成功率、P95 与最近样本。
 *
 * ## 为什么放在渠道工作台而不是独立页面
 *
 * 值班时的动线是「看渠道工作台 → 发现某条线不对 → 点进模型抽屉看定价」。
 * 健康数据夹在两者中间会打断动线；做成独立页则多一次跳转，而且线路级
 * 的问题（模型 A 挂了但模型 B 正常）在渠道维度看是看不出来的。
 *
 * ## 与「当前状态」的区别
 *
 * `/admin/channels/health` 给的是**现在**：启停、协议是否注册、是否冷却。
 * 本面板给的是**过去 24h / 7d**：成功率、耗时、最近报了什么错。
 * 两者要一起看 —— 「现在没冷却但 24h 成功率 40%」和「现在冷却中但 7d
 * 成功率 99%」要做的动作完全不同。
 */

/** 成功率 → 语义色：低于 50% 是危险，低于 90% 是警告 */
function rateTone(rate: number | null): 'success' | 'warn' | 'danger' | 'muted' {
  if (rate === null) return 'muted';
  if (rate < 0.5) return 'danger';
  if (rate < 0.9) return 'warn';
  return 'success';
}

function rateLabel(rate: number | null): string {
  if (rate === null) return '无样本';
  return `${(rate * 100).toFixed(1)}%`;
}

function formatDuration(ms: number | null): string {
  if (ms === null) return '—';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function ChannelModelHealthPanel({
  rows,
  loading,
}: {
  rows: ChannelModelHealthRowView[];
  loading: boolean;
}) {
  const columns: Array<AdminColumn<ChannelModelHealthRowView>> = useMemo(
    () => [
      {
        key: 'line',
        title: '线路',
        width: 240,
        render: (row) => (
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="truncate font-medium text-text-primary">{row.name}</span>
              {!row.enabled && <StatusTag status="disabled" tone="muted" label="停用" />}
              {!row.protocolKnown && (
                <HoverTip tip="该线路声明的协议在当前进程没有注册执行器，调用必定失败">
                  <StatusTag status="protocol-unknown" tone="danger" label="协议未注册" />
                </HoverTip>
              )}
              {row.coolingUntil && (
                <HoverTip tip={`冷却到 ${new Date(row.coolingUntil).toLocaleString('zh-CN')}`}>
                  <StatusTag status="cooling" tone="warn" label="冷却中" />
                </HoverTip>
              )}
            </div>
            <div className="mt-0.5 truncate font-mono text-[11px] text-text-tertiary">
              {row.channelName} · {row.capability}
            </div>
          </div>
        ),
      },
      {
        key: 'day',
        title: '24h 成功率',
        width: 130,
        render: (row) => {
          const window = row.windows.day;
          return (
            <div className="min-w-0">
              <StatusTag
                status="rate"
                tone={rateTone(window.successRate)}
                label={rateLabel(window.successRate)}
              />
              <div className="mt-0.5 text-[11px] text-text-tertiary">
                {window.samples > 0 ? `${window.samples} 次样本` : '窗口内没有终态调用'}
                {window.sampled ? ' · 按最近部分统计' : ''}
              </div>
            </div>
          );
        },
      },
      {
        key: 'week',
        title: '7d 成功率',
        width: 130,
        render: (row) => {
          const window = row.windows.week;
          return (
            <div className="min-w-0">
              <StatusTag
                status="rate"
                tone={rateTone(window.successRate)}
                label={rateLabel(window.successRate)}
              />
              <div className="mt-0.5 text-[11px] text-text-tertiary">{window.samples} 次样本</div>
            </div>
          );
        },
      },
      {
        key: 'p95',
        title: 'P95 耗时',
        width: 100,
        align: 'right',
        render: (row) => (
          <div className="tabular-nums">
            <div>{formatDuration(row.windows.day.p95DurationMs)}</div>
            <div className="text-[11px] text-text-tertiary">
              均 {formatDuration(row.windows.day.avgDurationMs)}
            </div>
          </div>
        ),
      },
      {
        key: 'recent',
        title: '最近样本',
        width: 220,
        render: (row) => {
          const sample = row.recent[0];
          if (!sample) {
            return <span className="text-text-placeholder">窗口内没有终态调用</span>;
          }
          return (
            <div className="min-w-0">
              <div className="truncate text-[11px] text-text-secondary">
                {sample.status === 'success' ? '成功' : '失败'} · {formatDuration(sample.durationMs)} ·{' '}
                {new Date(sample.at).toLocaleString('zh-CN')}
              </div>
              {row.lastErrorCode && (
                <HoverTip tip={row.recent.find((item) => item.error)?.error || row.lastErrorCode}>
                  <div className="truncate text-[11px] text-text-tertiary">最近错误 {row.lastErrorCode}</div>
                </HoverTip>
              )}
            </div>
          );
        },
      },
    ],
    [],
  );

  return (
    <AdminDataTable<ChannelModelHealthRowView>
      rows={rows}
      columns={columns}
      rowKey={(row) => row.id}
      loading={loading}
      emptyText="没有可观测的线路。健康指标按渠道模型统计，导入并启用模型后才有数据。"
      minWidth={900}
    />
  );
}
