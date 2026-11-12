import type { CreditLedgerEntry } from '../../types/api';
import { LEDGER_LABEL } from './constants';
import { formatDateTime, ledgerRemark } from './utils';

interface CreditsLedgerListProps {
  rows: CreditLedgerEntry[];
}

/**
 * 窄屏流水列表。
 *
 * ≤767px 时不再用表格: 五列在 680px 以下必然被卡片右缘切断，
 * 用户看到的是半截「变动」「备注」而不是可以横滚的表。改成两行一条:
 * 第一行类型 + 金额, 第二行时间 + 变动后余额, 备注另起一行。
 */
export function CreditsLedgerList({ rows }: CreditsLedgerListProps) {
  return (
    <ul className="credits-mobile-list">
      {rows.map((row) => {
        const remark = ledgerRemark(row);
        return (
          <li key={row.id} className="credits-mobile-item">
            <div className="credits-mobile-line">
              <span className="credits-mobile-title">{LEDGER_LABEL[row.type] ?? row.type}</span>
              <span className={`credits-amount ${row.amount >= 0 ? 'is-plus' : 'is-minus'}`}>
                {row.amount >= 0 ? `+${row.amount}` : row.amount}
              </span>
            </div>
            <div className="credits-mobile-meta">
              <span>{formatDateTime(row.createdAt)}</span>
              <span>变动后余额 {row.balanceAfter}</span>
            </div>
            {remark && <div className="credits-mobile-note">{remark}</div>}
          </li>
        );
      })}
    </ul>
  );
}
