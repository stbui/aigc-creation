import { CalendarDays, Coins, Crown } from 'lucide-react';
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
  onDelete: (row: AdminMembershipPlan) => void;
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
  onDelete,
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
          onDelete={() => onDelete(row)}
        />
      ))}
    </div>
  );
}

/**
 * 会员卡。
 *
 * 层级按运营视角排：**价格最强**，积分与有效期次之，权益与用量最弱。
 * 在售卡用品牌色 + 卡面渐变与同心圆水印；下架卡整体转灰但保留可读性。
 */
function PlanCard({
  row,
  writable,
  saving,
  onEdit,
  onToggle,
  onDelete,
}: {
  row: AdminMembershipPlan;
  writable: boolean;
  saving: boolean;
  onEdit: () => void;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const active = row.status === 'active';
  const builtIn = row.code === 'free';
  const durationText = row.durationDays === 0 ? '永久' : `${row.durationDays} 天`;

  return (
    <Card
      data-testid="admin-plan-card"
      data-row-key={row.id}
      data-plan-status={row.status}
      className={cn(
        'group relative flex h-full flex-col gap-0 overflow-hidden rounded-xl border py-0 transition-all duration-200',
        active
          ? 'border-border bg-card shadow-card hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-lg'
          : 'border-border/80 bg-muted/25 shadow-none hover:border-border',
      )}
    >
      {/* 卡面顶边：在售卡走品牌渐变，下架卡走中性细线 */}
      <div
        aria-hidden
        className={cn(
          'h-1 w-full shrink-0',
          active
            ? 'bg-gradient-to-r from-brand via-brand-light to-brand/40'
            : 'bg-border',
        )}
      />

      {/* 卡面装饰：淡品牌渐变 + 同心圆水印，替代整块彩色区块，保留会员卡质感 */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-1 h-32 overflow-hidden"
      >
        <div
          className={cn(
            'absolute inset-0',
            active
              ? 'bg-gradient-to-b from-brand-bg/80 via-brand-bg/25 to-transparent'
              : 'bg-gradient-to-b from-muted/60 to-transparent',
          )}
        />
        {/* 同心圆水印：三圈共用圆心，像实体会员卡上的压印纹样 */}
        <div className="absolute -top-20 -right-12 size-44">
          <div
            className={cn(
              'absolute inset-0 rounded-full border',
              active ? 'border-primary/12' : 'border-border/70',
            )}
          />
          <div
            className={cn(
              'absolute inset-5 rounded-full border',
              active ? 'border-primary/10' : 'border-border/55',
            )}
          />
          <div
            className={cn(
              'absolute inset-10 rounded-full border',
              active ? 'border-primary/8' : 'border-border/40',
            )}
          />
        </div>
      </div>

      {writable && (
        <button
          type="button"
          aria-label={`编辑会员套餐 ${row.name}`}
          className="absolute inset-0 z-10 cursor-pointer rounded-xl outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          onClick={onEdit}
        />
      )}

      <CardHeader className="pointer-events-none relative z-10 flex flex-col items-stretch gap-0 px-4 pt-3 pb-0">
        <div className="flex items-center justify-between gap-2">
          <StatusTag
            status={row.status}
            label={active ? '在售' : '已下架'}
            showDot={active}
          />
          {builtIn && (
            <ToneBadge
              tone={active ? 'brand' : 'neutral'}
              className={cn(
                'shrink-0 gap-1 border px-2',
                active ? 'border-primary/15' : 'border-border/60',
              )}
            >
              <Crown className="size-3" aria-hidden />
              内置
            </ToneBadge>
          )}
        </div>
        <CardTitle className="mt-3 truncate text-[16px] leading-6 font-semibold">
          {row.name}
        </CardTitle>
        <p
          className="mt-1 line-clamp-2 min-h-9 text-[12px] leading-[18px] text-muted-foreground"
          title={row.description || undefined}
        >
          {row.description || '暂无套餐说明'}
        </p>
      </CardHeader>

      <CardContent className="pointer-events-none relative z-10 flex flex-1 flex-col px-4 pt-3 pb-3">
        {/* 价格：全卡最强层级 */}
        <div
          className={cn(
            'flex items-baseline gap-1',
            active ? 'text-brand' : 'text-muted-foreground',
          )}
        >
          <span className="text-[15px] font-semibold">¥</span>
          <span className="truncate text-[32px] leading-none font-bold tracking-tight tabular-nums">
            {centsToYuan(row.priceCents)}
          </span>
        </div>
        <div className="mt-1 text-[12px] leading-4 text-muted-foreground">
          订阅价
        </div>

        {/* 次要信息：每月积分 / 有效期 */}
        <div className="mt-3 grid grid-cols-2 divide-x divide-border/80 overflow-hidden rounded-lg border border-border/70 bg-muted/40">
          <div className="flex min-w-0 items-center gap-2 px-2.5 py-2">
            <span
              className={cn(
                'flex size-7 shrink-0 items-center justify-center rounded-md',
                active
                  ? 'bg-brand-bg text-brand'
                  : 'bg-card text-muted-foreground',
              )}
            >
              <Coins className="size-3.5" aria-hidden />
            </span>
            <span className="min-w-0">
              <span className="block text-[12px] leading-4 text-muted-foreground">
                每月积分
              </span>
              <span
                className={cn(
                  'block truncate text-[14px] leading-5 font-semibold tabular-nums',
                  active ? 'text-foreground' : 'text-muted-foreground',
                )}
              >
                {row.monthlyCredits.toLocaleString('zh-CN')}
              </span>
            </span>
          </div>
          <div className="flex min-w-0 items-center gap-2 px-2.5 py-2">
            <span
              className={cn(
                'flex size-7 shrink-0 items-center justify-center rounded-md',
                active
                  ? 'bg-brand-bg text-brand'
                  : 'bg-card text-muted-foreground',
              )}
            >
              <CalendarDays className="size-3.5" aria-hidden />
            </span>
            <span className="min-w-0">
              <span className="block text-[12px] leading-4 text-muted-foreground">
                有效期
              </span>
              <span
                className={cn(
                  'block truncate text-[14px] leading-5 font-semibold tabular-nums',
                  active ? 'text-foreground' : 'text-muted-foreground',
                )}
              >
                {durationText}
              </span>
            </span>
          </div>
        </div>

        <div className="mt-3">
          <div className="mb-1.5 text-[12px] leading-4 font-medium text-muted-foreground">
            套餐权益
          </div>
          <div className="flex min-h-9 flex-wrap content-start gap-1.5">
            {row.perkLabels.length > 0 ? (
              row.perkLabels.map((label) => (
                <span
                  key={label}
                  className={cn(
                    'max-w-full truncate rounded-md px-2 py-1 text-[12px] leading-4',
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
              <span className="text-[12px] leading-4 text-muted-foreground">
                基础会员权益
              </span>
            )}
          </div>
        </div>

        <div className="mt-auto flex items-center gap-2 border-t border-border/60 pt-2.5 text-[12px] leading-4 text-muted-foreground tabular-nums">
          <span>会员 {row.memberCount}</span>
          <span aria-hidden className="h-3 w-px bg-border" />
          <span>订单 {row.orderCount}</span>
          <span aria-hidden className="h-3 w-px bg-border" />
          {/* 映射的分组决定该等级可见渠道与价格倍率；空 = 默认分组 */}
          <span className="truncate" title="会员等级映射的用户分组">
            分组 {row.userGroupCode || '默认'}
          </span>
        </div>
      </CardContent>

      {writable && (
        <>
          <Separator />
          <CardFooter
            role="group"
            aria-label={`${row.name} 操作`}
            className={cn(
              'relative z-20 flex items-center justify-end gap-1 px-2.5 py-1.5',
              active ? 'bg-card' : 'bg-transparent',
            )}
          >
            <ActionButton variant="ghost" size="sm" onClick={onEdit}>
              编辑
            </ActionButton>
            {builtIn ? (
              <span
                className="px-2 text-[12px] text-muted-foreground"
                title="该套餐由系统内置，不能下架或删除"
              >
                内置
              </span>
            ) : (
              <>
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
                <ActionButton
                  variant="ghost"
                  size="sm"
                  className="text-danger-text hover:text-danger-text"
                  disabled={saving}
                  onClick={onDelete}
                >
                  删除
                </ActionButton>
              </>
            )}
          </CardFooter>
        </>
      )}
    </Card>
  );
}
