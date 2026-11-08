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
        tone: key === 'uncertain' && (counts[key] ?? 0) > 0 ? 'danger' : undefined,
      }))}
    />
  );
}
