import { cn } from '../../../admin-ui/lib/cn';
import { toCredits } from '../../../lib/microcredits';
import { formatRate } from './utils';
import type { ModelCommerceProductView } from '../../../types/model';

const counts = new Intl.NumberFormat('zh-CN');

/** 金额可能带 6 位小数；列只有半格宽，超出时缩成 1 位，完整值放 title。 */
function shortCredits(microcredits: number): string {
  const text = toCredits(microcredits);
  if (text.length <= 8) return text;
  return Number(text).toFixed(1);
}

function Metric({
  label,
  value,
  title,
  tone,
}: {
  label: string;
  value: string;
  title?: string;
  tone?: 'danger' | 'muted';
}) {
  return (
    <span className="flex min-w-0 items-baseline gap-1 whitespace-nowrap" title={title}>
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span
        className={cn(
          'truncate font-medium tabular-nums text-foreground',
          tone === 'danger' && 'text-danger-text',
          tone === 'muted' && 'font-normal text-muted-foreground',
        )}
      >
        {value}
      </span>
    </span>
  );
}

/**
 * 「经营表现」单元格：调用量 / 净收入 / 毛利 / 退款率 2×2。
 *
 * 成本未知（后端 `marginMicrocredits === null`）必须显示「—」：写成 0 会让
 * 运营把「还没算成本」当成「毛利为零」，这是商品台账里最贵的一次误读。
 */
export function ModelCommerceMetricsCell({
  commerce,
  loading,
}: {
  commerce?: ModelCommerceProductView;
  loading?: boolean;
}) {
  if (!commerce) {
    return (
      <span className="text-[12px] text-muted-foreground" title="经营数据未加载或当前账号无权查看">
        {loading ? '读取中…' : '—'}
      </span>
    );
  }

  const margin = commerce.marginMicrocredits;

  return (
    <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-[12px] leading-4">
      <Metric
        label="调用"
        value={counts.format(commerce.calls)}
        tone={commerce.noCalls ? 'muted' : undefined}
        title={`近 7 天调用 ${counts.format(commerce.calls)} 次`}
      />
      <Metric
        label="净收"
        value={shortCredits(commerce.netMicrocredits)}
        title={`近 7 天净收入 ${toCredits(commerce.netMicrocredits)} 积分`}
      />
      <Metric
        label="毛利"
        value={margin === null ? '—' : shortCredits(margin)}
        tone={margin !== null && margin < 0 ? 'danger' : undefined}
        title={
          margin !== null
            ? `近 7 天毛利 ${toCredits(margin)} 积分`
            : `成本未知（${commerce.unknownCostOrders} 笔已结算订单无法计算成本），毛利不可用`
        }
      />
      <Metric
        label="退款"
        value={formatRate(commerce.refundRate)}
        tone={commerce.highRefund ? 'danger' : undefined}
        title={
          commerce.refundRate === null
            ? '暂无真实退款样本'
            : `退款率 ${formatRate(commerce.refundRate)}（已退 ${commerce.refundedOrders} 单）`
        }
      />
    </div>
  );
}
