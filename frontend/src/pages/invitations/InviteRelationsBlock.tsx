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
    <section className="rounded-xl border border-border bg-card px-6 pt-[22px] pb-6 max-[640px]:px-4 max-[640px]:pt-[18px] max-[640px]:pb-5">
      <div className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="m-0 flex items-center gap-2 text-base font-semibold text-foreground">
          <UserCheck size={16} aria-hidden /> 邀请记录
        </h2>
        <span className="text-xs leading-[18px] text-muted-foreground">
          共 {totalInvited} 人
          {relations.length < totalInvited ? `（已显示 ${relations.length} 条）` : ''}
        </span>
      </div>
      <ul className="m-0 flex list-none flex-col p-0">
        {relations.map((relation) => {
          const status = REWARD_STATUS[relation.rewardStatus] ?? REWARD_STATUS.pending;
          return (
            <li
              key={relation.id}
              className="flex items-center gap-3 border-t border-[var(--border-row)] py-3 text-[13px] first:border-t-0 first:pt-0 last:pb-0 max-[640px]:gap-2"
            >
              <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap font-medium text-foreground">
                {relation.inviteeName}
              </span>
              <span className="flex-none text-xs text-muted-foreground tabular-nums">
                {formatBoundDay(relation.boundAt)}
              </span>
              <span
                className={`min-w-[60px] flex-none rounded-full px-2 py-0.5 text-center text-xs ${status.className}`}
              >
                {status.label}
              </span>
            </li>
          );
        })}
      </ul>
      {relations.length < totalInvited && (
        <div className="my-4 mb-2 flex justify-center">
          <Button disabled={loadingMore} onClick={onLoadMore}>
            {loadingMore && <span className="state-spinner is-small" aria-hidden />}
            加载更多记录（已显示 {relations.length} / {totalInvited}）
          </Button>
        </div>
      )}
    </section>
  );
}
