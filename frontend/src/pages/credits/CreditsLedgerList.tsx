import type { CreditLedgerEntry } from '../../types/api';
import { AMOUNT_TONE } from './constants';
import { formatDateTime, ledgerRemark, ledgerTypeLabel } from './utils';

interface CreditsLedgerListProps {
  rows: CreditLedgerEntry[];
}

/**
 * 窄屏流水列表。
 *
 * ≤767px 时不再用表格: 六列在 850px 以下必然被卡片右缘切断，
 * 用户看到的是半截「变动」「备注」而不是可以横滚的表。改成两行一条:
 * 第一行类型 + 金额, 第二行时间 + 变动后余额, 备注另起一行。
 */
export function CreditsLedgerList({ rows }: CreditsLedgerListProps) {
  return (
    <ul className="m-0 list-none p-0">
      {rows.map((row) => {
        const remark = ledgerRemark(row);
        return (
          <li
            key={row.id}
            className="border-b border-border px-0.5 py-2.5 last:border-b-0"
          >
            <div className="flex min-h-[22px] items-center justify-between gap-3">
              <span className="text-[13px] font-semibold text-foreground">
                {ledgerTypeLabel(row)}
              </span>
              <span className={`text-sm ${row.amount >= 0 ? AMOUNT_TONE.plus : AMOUNT_TONE.minus}`}>
                {row.amount >= 0 ? `+${row.amount}` : row.amount}
              </span>
            </div>
            <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[13px] leading-5 text-muted-foreground tabular-nums">
              <span>{formatDateTime(row.createdAt)}</span>
              <span>变动后余额 {row.balanceAfter}</span>
            </div>
            {remark && <div className="mt-0.5 text-[13px] leading-5 text-muted-foreground">{remark}</div>}
          </li>
        );
      })}
    </ul>
  );
}
