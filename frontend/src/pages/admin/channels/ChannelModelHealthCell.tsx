import { HelpTip, StatusTag } from '~/admin-ui/primitives';
import {
  formatAmount,
  formatMarkupPercent,
  formatRate,
  healthTone,
  markupPercent,
  tierPriceLines,
} from './utils';
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
    return <span className="text-[12px] text-muted-foreground">读取中…</span>;
  }
  if (!health || health.windows.day.samples === 0) {
    // 这一列只有 100px 出头：长句「近 24 小时无调用」会吃掉整列，细因放进提示
    return (
      <span className="text-[12px] text-muted-foreground" title="近 24 小时没有终态调用">
        无调用
      </span>
    );
  }

  const window = health.windows.day;
  const tone = healthTone(window.successRate, window.samples);
  const recent = health.recent.slice(0, 10);
  const slots = Array.from({ length: 10 }, (_, index) => recent[index] ?? null);

  const tip = (
    <div className="flex flex-col gap-1 text-[12px]">
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
    <HelpTip tip={tip}>
      <div
        className="flex min-w-0 cursor-default flex-col gap-1"
        tabIndex={0}
        aria-label={`近 24 小时成功率 ${formatRate(window.successRate)}，共 ${window.samples} 次调用`}
      >
        <div className="flex items-center gap-1.5">
          <StatusTag status="rate" tone={tone} label={formatRate(window.successRate)} />
          <span className="text-[12px] tabular-nums text-muted-foreground">{window.samples} 次</span>
        </div>
        <div className="flex items-center gap-0.5" aria-hidden>
          {slots.map((sample, index) => (
            <span
              key={index}
              className={
                sample === null
                  ? 'h-1.5 w-2 rounded-[2px] bg-muted'
                  : sample.status === 'success'
                    ? 'h-1.5 w-2 rounded-[2px] bg-success-text'
                    : 'h-1.5 w-2 rounded-[2px] bg-danger-text'
              }
            />
          ))}
        </div>
      </div>
    </HelpTip>
  );
}

/**
 * 成本价 / 销售价 / 加价率 的并列摘要。
 *
 * 只列**已启用**的价格档，且最多 3 条 —— 列表行的高度不能随规格数爆炸。
 * 其余规格折叠成一行「其余 N 个规格」提示，不静默丢弃。
 *
 * 每条价格档占**一行**：规格名在左（截断），「成本 → 售价 加价率」在右。
 * 两行式（规格一行、价格一行）在 180px 列里会把两档价格撑成四行，行高翻倍
 * 且看不出哪行属于哪档；完整口径（成本 / 售价 / 加价率原值）放在 title 里。
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
    return <span className="text-[12px] text-muted-foreground">无已启用规格</span>;
  }
  const shown = lines.slice(0, 3);
  const rest = lines.slice(3);

  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      {shown.map((line) => {
        const percent = markupPercent(line.cost, line.sale);
        const cost = formatAmount(line.cost);
        const sale = formatAmount(line.sale);
        const markupText = percent === null ? '—' : `${percent >= 0 ? '+' : ''}${compactPercent(percent)}`;
        const full = `${line.specLabel} · 成本 ${cost} / 售价 ${sale}${
          percent === null ? '' : ` · 加价 ${formatMarkupPercent(line.cost, line.sale)}`
        }`;
        return (
          <div
            key={`${line.tierId}:${line.field.key}`}
            className="flex min-w-0 items-baseline gap-2 whitespace-nowrap text-[12px] leading-4 tabular-nums"
            title={full}
          >
            <span className="min-w-0 truncate text-muted-foreground">{line.specLabel}</span>
            <span className="ml-auto flex shrink-0 items-baseline gap-1">
              <span className="text-muted-foreground">{cost}</span>
              <span className="text-muted-foreground" aria-hidden>
                →
              </span>
              <span className="font-medium text-foreground">{sale}</span>
              {model.priceCurrency && model.priceCurrency !== 'credits' ? (
                /*
                 * 货币计价：成本恒是积分、售价是该货币单位，加价率依赖分组兑换比例，
                 * 这里推算不出来。两侧单位必须分开标注，否则「0.8 → 0.5」
                 * 会被误读成同一单位的两个数。
                 */
                <span className="text-muted-foreground">
                  积分 → {model.priceCurrency}
                </span>
              ) : (
                <span
                  className={
                    percent === null
                      ? 'text-muted-foreground'
                      : percent < 0
                        ? 'text-danger-text'
                        : 'text-success-text'
                  }
                >
                  {markupText}
                </span>
              )}
            </span>
          </div>
        );
      })}
      {rest.length > 0 && (
        /*
         * 其余规格**可展开**：规格多的模型（token 计费 3 个字段 × 3 档 = 9 行）
         * 折叠成一行静态文字后，后面 6 行永远看不到 —— 调价前无法核对。
         * 用原生 <details>，不引额外组件。
         */
        <details className="text-[12px] text-muted-foreground">
          <summary className="cursor-pointer">其余 {rest.length} 个规格</summary>
          <div className="mt-0.5 flex flex-col gap-0.5">
            {rest.map((line) => (
              <div
                key={`${line.tierId}:${line.field.key}`}
                className="flex min-w-0 items-baseline gap-2 whitespace-nowrap tabular-nums"
                title={`${line.specLabel} · 成本 ${formatAmount(line.cost)} / 售价 ${formatAmount(line.sale)}`}
              >
                <span className="min-w-0 truncate">{line.specLabel}</span>
                <span className="ml-auto flex shrink-0 items-baseline gap-1">
                  <span>{formatAmount(line.cost)}</span>
                  <span aria-hidden>→</span>
                  <span className="font-medium">{formatAmount(line.sale)}</span>
                </span>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

/** 列内加价率只留一位小数：`20.00%` 在 180px 列里会把规格名挤到截断 */
function compactPercent(percent: number): string {
  return `${percent.toFixed(1).replace(/\.0$/, '')}%`;
}
