import { CalendarDays, Crown } from 'lucide-react';
import {
  ActionButton,
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  EmptyState,
  ListError,
  Separator,
  SkeletonCards,
  StatusTag,
  ToneBadge,
} from '~/admin-ui/primitives';
import { cn } from '~/admin-ui/lib/cn';
import { centsToYuan } from './utils';
import type { AdminMembershipPlan } from '../../../types/api';

interface PlanCardGridProps {
  rows: AdminMembershipPlan[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  writable: boolean;
  saving: boolean;
  onCreate: () => void;
  onEdit: (row: AdminMembershipPlan) => void;
  onToggle: (row: AdminMembershipPlan) => void;
}

/** 会员套餐卡片列表：一张卡片对应一个套餐，保留列表的加载与空态。 */
export function PlanCardGrid({
  rows,
  loading,
  error,
  onRetry,
  writable,
  saving,
  onCreate,
  onEdit,
  onToggle,
}: PlanCardGridProps) {
  if (loading && rows.length === 0) {
    return (
      <SkeletonCards
        count={8}
        className="mt-0"
        gridClassName="grid-cols-1 md:grid-cols-2 xl:grid-cols-4"
      />
    );
  }

  if (error && rows.length === 0) {
    return <ListError error={error} onRetry={onRetry} />;
  }

  if (!loading && !error && rows.length === 0) {
    return (
      <EmptyState
        title="还没有会员套餐。新建一个套餐，C 端价目表才会出现可订阅项。"
        action={
          writable ? (
            <ActionButton size="sm" onClick={onCreate}>
              新建套餐
            </ActionButton>
          ) : undefined
        }
      />
    );
  }

  return (
    <div
      data-testid="admin-plan-grid"
      aria-busy={loading}
      className={cn(
        'grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4',
        loading && 'opacity-60',
      )}
    >
      {rows.map((row) => (
        <PlanCard
          key={row.id}
          row={row}
          writable={writable}
          saving={saving}
          onEdit={() => onEdit(row)}
          onToggle={() => onToggle(row)}
        />
      ))}
    </div>
  );
}

function PlanCard({
  row,
  writable,
  saving,
  onEdit,
  onToggle,
}: {
  row: AdminMembershipPlan;
  writable: boolean;
  saving: boolean;
  onEdit: () => void;
  onToggle: () => void;
}) {
  const active = row.status === 'active';
  const builtIn = row.code === 'free';

  return (
    <Card
      data-testid="admin-plan-card"
      data-row-key={row.id}
      data-plan-status={row.status}
      className={cn(
        'group relative flex h-full gap-0 overflow-hidden rounded-xl border-border py-0 shadow-card transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg focus-within:border-primary',
        active
          ? 'bg-card hover:border-primary/35'
          : 'border-border/80 bg-muted/40 shadow-none hover:border-border',
      )}
    >
      {writable && (
        <button
          type="button"
          aria-label={`编辑会员套餐 ${row.name}`}
          className="absolute inset-0 z-10 cursor-pointer rounded-xl outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          onClick={onEdit}
        />
      )}

      <div
        className={cn(
          'pointer-events-none relative h-[98px] shrink-0 overflow-hidden border-b border-border/70',
          active
            ? 'bg-gradient-to-br from-accent via-primary/10 to-warn-soft/60'
            : 'bg-gradient-to-br from-muted via-muted/75 to-muted/50',
        )}
      >
        <div
          className={cn(
            'absolute -top-10 -right-8 size-28 rounded-full border',
            active
              ? 'border-primary/10 bg-primary/10'
              : 'border-border/60 bg-card/40',
          )}
        />
        <div
          className={cn(
            'absolute -bottom-12 -left-10 size-28 rounded-full border',
            active
              ? 'border-card/60 bg-card/35'
              : 'border-border/50 bg-card/30',
          )}
        />
        <div className="relative z-10 flex h-full items-center justify-center">
          <div
            className={cn(
              'flex items-center gap-2.5 rounded-xl border px-3.5 py-2 shadow-sm backdrop-blur-sm',
              active
                ? 'border-primary/15 bg-card/90'
                : 'border-border/70 bg-card/60',
            )}
          >
            <span
              className={cn(
                'flex size-8 items-center justify-center rounded-lg',
                active
                  ? 'bg-primary/10 text-primary'
                  : 'bg-muted text-muted-foreground',
              )}
            >
              <CalendarDays
                className="size-[18px]"
                strokeWidth={1.8}
                aria-hidden
              />
            </span>
            <span className="flex items-baseline gap-1">
              <span
                className={cn(
                  'text-[22px] leading-6 font-bold tabular-nums',
                  active ? 'text-foreground' : 'text-muted-foreground',
                )}
              >
                {row.durationDays === 0 ? '永久' : row.durationDays}
              </span>
              <span className="text-[11px] font-medium text-muted-foreground">
                {row.durationDays === 0 ? '会员' : '天'}
              </span>
            </span>
          </div>
        </div>

        <div className="absolute inset-x-3 top-3 z-10 flex items-start justify-between gap-2">
          <StatusTag
            status={row.status}
            label={active ? '在售' : '已下架'}
            showDot={active}
          />
          {builtIn && (
            <ToneBadge
              tone={active ? 'brand' : 'neutral'}
              className={cn(
                'shrink-0 gap-1 border px-1.5 text-[11px] shadow-sm',
                active ? 'border-primary/15' : 'border-border/60',
              )}
            >
              <Crown className="size-3" aria-hidden />
              内置
            </ToneBadge>
          )}
        </div>
      </div>

      <CardHeader className="pointer-events-none px-4 pt-3 pb-2.5">
        <div className="min-w-0">
          <CardTitle className="truncate text-[15px] leading-5 font-semibold">
            {row.name}
          </CardTitle>
          <p
            className="mt-1 line-clamp-2 min-h-8 text-[12px] leading-4 text-muted-foreground"
            title={row.description || undefined}
          >
            {row.description || '暂无套餐说明'}
          </p>
        </div>
      </CardHeader>

      <CardContent className="pointer-events-none flex flex-1 flex-col px-4 pb-3">
        <div className="flex items-end justify-between gap-2 border-t border-border/60 pt-2.5">
          <div className="min-w-0">
            <div
              className={cn(
                'flex items-baseline gap-1',
                active ? 'text-primary' : 'text-muted-foreground',
              )}
            >
              <span className="text-[13px] font-semibold">¥</span>
              <span className="truncate text-[27px] leading-8 font-bold tabular-nums">
                {centsToYuan(row.priceCents)}
              </span>
            </div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">
              订阅价
            </div>
          </div>
          <div className="rounded-lg bg-muted/60 px-2 py-1.5 text-right">
            <div className="text-[10px] text-muted-foreground">每月积分</div>
            <div
              className={cn(
                'mt-0.5 whitespace-nowrap text-[12px] font-semibold tabular-nums',
                active ? 'text-foreground' : 'text-muted-foreground',
              )}
            >
              {row.monthlyCredits.toLocaleString('zh-CN')}
            </div>
          </div>
        </div>

        <div className="mt-2.5 min-h-[42px]">
          <div className="mb-1.5 text-[10px] font-medium text-muted-foreground">
            套餐权益
          </div>
          <div className="flex flex-wrap gap-1">
            {row.perkLabels.length > 0 ? (
              row.perkLabels.map((label) => (
                <span
                  key={label}
                  className={cn(
                    'max-w-full truncate rounded-md px-1.5 py-0.5 text-[11px]',
                    active
                      ? 'bg-accent text-accent-foreground'
                      : 'bg-muted text-muted-foreground',
                  )}
                  title={label}
                >
                  {label}
                </span>
              ))
            ) : (
              <span className="text-[11px] text-muted-foreground">
                基础会员权益
              </span>
            )}
          </div>
        </div>

        <div className="mt-auto border-t border-border/60 pt-2.5 text-[11px] text-muted-foreground tabular-nums">
          会员 {row.memberCount} · 订单 {row.orderCount}
        </div>
      </CardContent>

      {writable && (
        <>
          <Separator />
          <CardFooter
            role="group"
            aria-label={`${row.name} 操作`}
            className={cn(
              'relative z-20 flex items-center justify-end gap-1 px-2 py-1.5',
              active ? 'bg-muted/20' : 'bg-muted/45',
            )}
          >
            <ActionButton variant="ghost" size="sm" onClick={onEdit}>
              编辑
            </ActionButton>
            {builtIn ? (
              <span
                className="px-2 text-[12px] text-muted-foreground"
                title="该套餐由系统内置，不能下架"
              >
                内置
              </span>
            ) : (
              <ActionButton
                variant="ghost"
                size="sm"
                className={cn(
                  active && 'text-danger-text hover:text-danger-text',
                )}
                disabled={saving}
                onClick={onToggle}
              >
                {active ? '下架' : '上架'}
              </ActionButton>
            )}
          </CardFooter>
        </>
      )}
    </Card>
  );
}
