import { UserCheck } from 'lucide-react';

import { REWARD_STATUS, type MyInvites } from './constants';
import { Button } from './components';
import { formatBoundDay } from './utils';

interface InviteRelationsBlockProps {
  relations: MyInvites['relations'];
  totalInvited: number;
  loadingMore: boolean;
  onLoadMore: () => void;
}

/** 邀请记录：已产生的关系与分页加载。 */
export function InviteRelationsBlock({
  relations,
  totalInvited,
  loadingMore,
  onLoadMore,
}: InviteRelationsBlockProps) {
  return (
    <section className="invite-block">
      <div className="invite-block-head">
        <h2>
          <UserCheck size={16} aria-hidden /> 邀请记录
        </h2>
        <span className="invite-block-sub">
          共 {totalInvited} 人
          {relations.length < totalInvited ? `（已显示 ${relations.length} 条）` : ''}
        </span>
      </div>
      <ul className="invite-relations">
        {relations.map((relation) => {
          const status = REWARD_STATUS[relation.rewardStatus] ?? REWARD_STATUS.pending;
          return (
            <li key={relation.id} className="invite-relation">
              <span className="invite-relation-name">{relation.inviteeName}</span>
              <span className="invite-relation-date">{formatBoundDay(relation.boundAt)}</span>
              <span className={`invite-relation-status ${status.className}`}>{status.label}</span>
            </li>
          );
        })}
      </ul>
      {relations.length < totalInvited && (
        <div className="invite-load-more">
          <Button loading={loadingMore} onClick={onLoadMore}>
            加载更多记录（已显示 {relations.length} / {totalInvited}）
          </Button>
        </div>
      )}
    </section>
  );
}
