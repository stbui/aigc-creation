import { HoverTip, StatusTag } from './components';
import { formatMarkupPercent, formatAmount, tierPriceLines } from '../../../lib/channelCost';
import type {
  AdminChannelModelListItem,
  ChannelModelHealthRowView,
  ChannelModelPriceTierView,
} from '../../../types/model';

/**
 * 线路稳定性单元格：24h 成功率 + 最近 10 次结果色块。
 *
 * ## 为什么只给 24h，不给 7d
 *
 * 这一列是「列表里扫一眼」的用色块，7 天成功率在长尾上更平滑，但值班时
 * 要判断的是「现在这条线是不是在挂」。7d 成功率、P95、最近失败都在
 * 悬停提示里，需要时再看。
 *
 * ## 色块从左到右 = 从旧到新
 *
 * 与参考实现一致：最右是最新一次。空槽（不足 10 次）留白而不是补灰 ——
 * 补灰会被读成「失败过」。
 */

/** 成功率 → 语义色 */
export function healthTone(rate: number | null, samples: number): 'success' | 'warn' | 'danger' | 'muted' {
  if (rate === null || samples === 0) return 'muted';
  if (rate >= 0.95) return 'success';
  if (rate >= 0.8) return 'warn';
  return 'danger';
}

/**
 * 成功率展示。
 *
 * 只有**恰好 100%** 时才省略小数尾巴 —— 参考实现的口径是「≥ 99.5% 显示
 * 0 位小数」，那会让 99.5% 显示成 `100%`：一条十天挂一次的线在界面上
 * 读起来像是「从没失败过」。1 位小数在这个量级下足够精确，且不会说谎。
 */
export function formatRate(rate: number | null): string {
  if (rate === null) return '—';
  return `${(rate * 100).toFixed(rate === 0 || rate === 1 ? 0 : 1)}%`;
}

function formatDuration(ms: number | null): string {
  if (ms === null) return '—';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * 稳定性单元格。
 *
 * `health` 为 undefined 时按「无数据」渲染 —— 读取失败只影响这一格，
 * 不该让整张表不可读。
 */
export function ChannelModelHealthCell({
  health,
  loading,
}: {
  health?: ChannelModelHealthRowView;
  loading?: boolean;
}) {
  if (loading && !health) {
    return <span className="text-[11px] text-text-tertiary">读取中…</span>;
  }
  if (!health || health.windows.day.samples === 0) {
    return <span className="text-[11px] text-text-tertiary">近 24 小时无调用</span>;
  }

  const window = health.windows.day;
  const tone = healthTone(window.successRate, window.samples);
  const recent = health.recent.slice(0, 10);
  const slots = Array.from({ length: 10 }, (_, index) => recent[index] ?? null);

  const tip = (
    <div className="flex flex-col gap-1 text-[11px]">
      <div>
        近 24 小时：{window.samples} 次，成功 {window.success}，失败 {window.failed}
      </div>
      <div>
        近 7 天成功率：{formatRate(health.windows.week.successRate)}（{health.windows.week.samples} 次）
      </div>
      <div>近 24 小时 P95 耗时：{formatDuration(window.p95DurationMs)}</div>
      {health.lastErrorCode && <div>最近错误：{health.lastErrorCode}</div>}
      <div className="opacity-70">只统计模型生成请求；色块从左到右为最近 10 次，最右为最新。</div>
    </div>
  );

  return (
    <HoverTip tip={tip}>
      <div
        className="flex min-w-0 cursor-default flex-col gap-1"
        tabIndex={0}
        aria-label={`近 24 小时成功率 ${formatRate(window.successRate)}，共 ${window.samples} 次调用`}
      >
        <div className="flex items-center gap-1.5">
          <StatusTag status="rate" tone={tone} label={formatRate(window.successRate)} />
          <span className="text-[11px] tabular-nums text-text-tertiary">{window.samples} 次</span>
        </div>
        <div className="flex items-center gap-0.5" aria-hidden>
          {slots.map((sample, index) => (
            <span
              key={index}
              className={
                sample === null
                  ? 'h-1.5 w-2 rounded-[2px] bg-background-secondary-default'
                  : sample.status === 'success'
                    ? 'h-1.5 w-2 rounded-[2px] bg-emerald-500'
                    : 'h-1.5 w-2 rounded-[2px] bg-rose-500'
              }
            />
          ))}
        </div>
      </div>
    </HoverTip>
  );
}

/**
 * 成本价 / 销售价 / 加价率 的并列摘要。
 *
 * 只列**已启用**的价格档，且最多 3 条 —— 列表行的高度不能随规格数爆炸。
 * 其余规格折叠成一行「其余 N 个规格」提示，不静默丢弃。
 */
export function ChannelModelCostSummary({
  model,
  tiers,
}: {
  /** 只读这两项：单渠道与跨渠道视图共用同一份摘要 */
  model: Pick<AdminChannelModelListItem, 'capability' | 'priceCurrency'>;
  tiers: ChannelModelPriceTierView[];
}) {
  const lines = tierPriceLines(model.capability, tiers);
  if (lines.length === 0) {
    return <span className="text-[11px] text-text-tertiary">无已启用规格</span>;
  }
  const shown = lines.slice(0, 3);
  const rest = lines.length - shown.length;

  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      {shown.map((line) => (
        <div key={`${line.tierId}:${line.field.key}`} className="min-w-0 text-[11px]">
          <span className="truncate text-text-secondary">{line.specLabel}</span>
          <span className="mx-1 text-text-placeholder">·</span>
          <span className="tabular-nums text-text-primary">成本 {formatAmount(line.cost)}</span>
          <span className="mx-1 text-text-placeholder">/</span>
          <span className="tabular-nums text-text-primary">售价 {formatAmount(line.sale)}</span>
          {model.priceCurrency && model.priceCurrency !== 'credits' ? (
            <span className="ml-1 text-text-tertiary">售价币种 {model.priceCurrency}</span>
          ) : (
            <span className="ml-1 text-text-tertiary">
              加价 {formatMarkupPercent(line.cost, line.sale)}
            </span>
          )}
        </div>
      ))}
      {rest > 0 && <div className="text-[11px] text-text-tertiary">其余 {rest} 个规格</div>}
    </div>
  );
}
