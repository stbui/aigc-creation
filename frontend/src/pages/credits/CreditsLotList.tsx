import type { CreditLot } from '../../types/api';
import { Tag } from './components';
import { LOT_STATUS, SOURCE_LABEL } from './constants';
import { formatDate } from './utils';

interface CreditsLotListProps {
  rows: CreditLot[];
}

/** 窄屏批次列表: 来源 + 状态一行, 剩余 / 总额 / 到期日一行。 */
export function CreditsLotList({ rows }: CreditsLotListProps) {
  return (
    <ul className="credits-mobile-list">
      {rows.map((lot) => (
        <li key={lot.id} className="credits-mobile-item">
          <div className="credits-mobile-line">
            <span className="credits-mobile-title">{SOURCE_LABEL[lot.source] ?? lot.source}</span>
            <Tag variant="filled" className={`credits-status is-${lot.status}`}>
              {LOT_STATUS[lot.status] ?? LOT_STATUS.active}
            </Tag>
          </div>
          <div className="credits-mobile-meta">
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
