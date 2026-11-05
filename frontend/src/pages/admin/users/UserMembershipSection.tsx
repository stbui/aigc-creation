import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DetailSection,
  EmptyState,
  Separator,
  StatusTag,
  formatYuan,
} from '~/admin-ui/primitives';
import type {
  AdminUserMembership,
  AdminUserMembershipHistoryItem,
} from '../../../types/admin-users';
import { formatDateTime } from './utils';

const MEMBERSHIP_STATUS_META = {
  active: { label: '生效中', tone: 'success' },
  scheduled: { label: '待生效', tone: 'brand' },
  grace: { label: '宽限期', tone: 'warn' },
  cancelled: { label: '已取消续费', tone: 'warn' },
  expired: { label: '已过期', tone: 'muted' },
  refunded: { label: '已退款', tone: 'muted' },
} as const;

function MembershipStatus({ status }: { status: string | null }) {
  const meta = status ? MEMBERSHIP_STATUS_META[status as keyof typeof MEMBERSHIP_STATUS_META] : null;
  return (
    <StatusTag
      status={status ?? 'unknown'}
      label={meta?.label ?? status ?? '无会员'}
      tone={meta?.tone ?? 'muted'}
      showDot
    />
  );
}

function MembershipFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-[13px] leading-5 text-foreground">{value}</dd>
    </div>
  );
}

/** 用户详情中的会员权益与订阅历史。 */
export function UserMembershipSection({
  membership,
  history,
}: {
  membership: AdminUserMembership;
  history: AdminUserMembershipHistoryItem[];
}) {
  return (
    <div data-testid="admin-user-membership">
      <DetailSection title="会员" note={membership.isMember ? '当前权益' : undefined}>
        {membership.isMember ? (
          <Card className="gap-0 rounded-xl border-border bg-card py-0 shadow-none">
            <CardHeader className="grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-4 py-3">
              <CardTitle className="min-w-0">
                <h4 className="m-0 truncate text-[15px] leading-6 font-semibold text-foreground">
                  {membership.planName}
                </h4>
              </CardTitle>
              <CardAction className="col-start-2 row-span-1 row-start-1 self-center">
                <MembershipStatus status={membership.status} />
              </CardAction>
              <CardDescription className="col-start-1 row-start-2 m-0 font-mono text-[11px]">
                {membership.planCode}
              </CardDescription>
            </CardHeader>
            <Separator />
            <CardContent className="px-4 py-3">
              <dl className="grid grid-cols-2 gap-x-6 gap-y-3">
                <MembershipFact label="开通时间" value={formatDateTime(membership.startAt)} />
                <MembershipFact label="到期时间" value={formatDateTime(membership.expiresAt)} />
                <MembershipFact label="每月积分" value={`${membership.monthlyCredits} 积分`} />
                <MembershipFact
                  label="自动续费"
                  value={
                    membership.cancelAtPeriodEnd ? '已关闭，权益保留至到期' : '已开启'
                  }
                />
              </dl>
            </CardContent>
          </Card>
        ) : (
          <EmptyState
            title="当前未开通会员"
            description="该用户没有生效中的会员订阅，历史订阅仍保留在下方。"
            className="border-0 px-4 py-6"
          />
        )}

        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 rounded-lg bg-muted/40 px-3 py-2 text-[12px] text-muted-foreground">
          <span>
            累计节省{' '}
            <strong className="font-semibold text-foreground tabular-nums">
              {formatYuan(membership.savedCents)}
            </strong>
          </span>
          <span>
            优惠订单{' '}
            <strong className="font-semibold text-foreground tabular-nums">
              {membership.discountedOrders}
            </strong>{' '}
            笔
          </span>
        </div>

        {history.length > 0 ? (
          <div className="mt-4">
            <div className="mb-1.5 flex items-baseline justify-between gap-2">
              <h4 className="text-[13px] font-medium text-foreground">订阅周期</h4>
              <span className="text-[11px] text-muted-foreground">
                最近 {history.length} 个周期
              </span>
            </div>
            <ul className="flex flex-col divide-y divide-border/70">
              {history.map((item) => (
                <li key={item.id} className="flex items-start gap-3 px-1 py-2.5">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium text-foreground">
                      {item.planName}
                    </span>
                    <span className="mt-0.5 block text-[11px] leading-5 text-muted-foreground">
                      {formatDateTime(item.startAt)} 至 {formatDateTime(item.expiresAt)}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <MembershipStatus status={item.status} />
                    <span className="mt-1 block text-[11px] text-muted-foreground tabular-nums">
                      {item.monthlyCredits} 积分/月
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </DetailSection>
    </div>
  );
}
