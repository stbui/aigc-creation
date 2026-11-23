import type { CreditLot } from '../../types/api';
import { Badge } from './components';
import { LOT_STATUS, LOT_STATUS_TONE, SOURCE_LABEL } from './constants';
import { formatDate } from './utils';

interface CreditsLotListProps {
  rows: CreditLot[];
}

/** 窄屏批次列表: 来源 + 状态一行, 剩余 / 总额 / 到期日一行。 */
export function CreditsLotList({ rows }: CreditsLotListProps) {
  return (
    <ul className="m-0 list-none p-0">
      {rows.map((lot) => (
        <li
          key={lot.id}
          className="border-b border-border px-0.5 py-2.5 last:border-b-0"
        >
          <div className="flex min-h-[22px] items-center justify-between gap-3">
            <span className="text-[13px] font-semibold text-foreground">
              {SOURCE_LABEL[lot.source] ?? lot.source}
            </span>
            <Badge
              variant="secondary"
              className={`h-[22px] rounded-full border-0 px-2 text-xs font-medium ${LOT_STATUS_TONE[lot.status]}`}
            >
              {LOT_STATUS[lot.status] ?? LOT_STATUS.active}
            </Badge>
          </div>
          <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[13px] leading-5 text-muted-foreground tabular-nums">
            <span>
              剩余 {lot.remainingCredits}，共 {lot.totalCredits}
            </span>
            <span>{lot.expireAt ? `${formatDate(lot.expireAt)} 到期` : '长期有效'}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}
