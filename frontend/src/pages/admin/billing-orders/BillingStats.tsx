import { StatCards } from '~/admin-ui/primitives';
import { STATUS_LABELS } from './constants';

/**
 * 五个账单状态的计数条。
 *
 * 「结果不明」有量时标红：这一档既不切线也不退款，等人工处置，放任堆积
 * 就是持续的对不上账。
 */
export function BillingStats({ counts }: { counts: Record<string, number> }) {
  return (
    <StatCards
      columns={5}
      className="mb-3"
      items={Object.entries(STATUS_LABELS).map(([key, label]) => ({
        key,
        label,
        value: counts[key] ?? 0,
        // 计数按账单状态原样统计；线路切换的旧账单也是 refunded，但财务「已退」口径会剔除它
        hint: key === 'refunded' ? '含线路切换（内部重预留）' : undefined,
        tone: key === 'uncertain' && (counts[key] ?? 0) > 0 ? 'danger' : undefined,
      }))}
    />
  );
}
