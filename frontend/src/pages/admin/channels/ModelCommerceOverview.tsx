import { Button, StatCards, StaleError, type StatCardItem } from '~/admin-ui/primitives';
import { toCredits } from '../../../lib/microcredits';
import { formatRate } from './utils';
import type { ModelCommerceOverviewView } from '../../../types/model';

const counts = new Intl.NumberFormat('zh-CN');

function money(microcredits: number | null): string {
  return microcredits === null ? '—' : toCredits(microcredits);
}

function statItems(overview: ModelCommerceOverviewView): StatCardItem[] {
  const { summary } = overview;
  return [
    {
      key: 'calls',
      label: '调用量',
      value: counts.format(summary.calls),
      hint: `已结算 ${counts.format(summary.settledOrders)} 单`,
    },
    {
      key: 'net',
      label: '净收入',
      value: money(summary.netMicrocredits),
      hint: `已退 ${money(summary.refundedMicrocredits)} 积分`,
    },
    {
      key: 'margin',
      label: '毛利',
      value: money(summary.marginMicrocredits),
      hint:
        summary.costMicrocredits === null
          ? `成本未知 ${counts.format(summary.unknownCostOrders)} 笔，不按 0 计`
          : `成本 ${money(summary.costMicrocredits)} 积分`,
      tone: summary.lowMarginProducts > 0 ? 'warn' : undefined,
    },
    {
      key: 'refund',
      label: '退款率',
      value: formatRate(summary.refundRate),
      hint:
        summary.refundRate === null
          ? '暂无真实退款样本'
          : `已退 ${counts.format(summary.refundedOrders)} 单`,
      tone: summary.highRefundProducts > 0 ? 'danger' : undefined,
    },
    {
      key: 'pending-pricing',
      label: '待定价',
      value: counts.format(summary.pendingPricingProducts),
      hint: '补价工作队列',
      tone: summary.pendingPricingProducts > 0 ? 'warn' : undefined,
    },
    {
      key: 'no-calls',
      label: '无调用',
      value: counts.format(summary.noCallsProducts),
      hint: '近 7 天没有真实调用',
    },
    {
      key: 'low-margin',
      label: '低毛利',
      value: counts.format(summary.lowMarginProducts),
      hint: '毛利低于 20%',
      tone: summary.lowMarginProducts > 0 ? 'warn' : undefined,
    },
    {
      key: 'invalid-binding',
      label: '失效绑定',
      value: counts.format(summary.invalidBindingCount),
      hint: '能力绑定需要修复',
      tone: summary.invalidBindingCount > 0 ? 'danger' : undefined,
    },
  ];
}

/**
 * 商品台账顶部的经营总览。
 *
 * 这组数字回答「今天该先处理什么」：待定价、无调用、低毛利、失效绑定。
 * 经营数据与商品列表分开取数，读取失败时只提示、不阻塞台账本身。
 */
export function ModelCommerceOverview({
  overview,
  loading,
  error,
  onRetry,
}: {
  overview: ModelCommerceOverviewView | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  if (error && !overview) {
    return (
      <div
        data-testid="admin-model-commerce-overview"
        className="flex items-center gap-2 rounded-lg border border-warn-soft bg-warn-soft px-3 py-2 text-xs text-warn-text"
      >
        <span className="min-w-0 flex-1">经营数据读取失败：{error}。商品台账仍可正常使用。</span>
        <Button variant="ghost" size="xs" className="shrink-0 text-inherit" onClick={onRetry}>
          重试
        </Button>
      </div>
    );
  }

  const items = overview
    ? statItems(overview)
    : Array.from({ length: 8 }, (_, index) => ({
        key: `placeholder-${index}`,
        label: '经营数据',
        value: '—',
        hint: loading ? '读取中…' : '暂无数据',
      }));

  return (
    <section data-testid="admin-model-commerce-overview" className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium text-foreground">
          近 7 天经营表现
          <span className="ml-2 text-[12px] font-normal text-muted-foreground">
            调价前先看毛利，补价前先看无调用
          </span>
        </h3>
        {loading && overview && <span className="text-[12px] text-muted-foreground">刷新中…</span>}
      </div>
      {error && overview && <StaleError error={error} onRetry={onRetry} />}
      <StatCards items={items} minWidth={124} />
    </section>
  );
}
