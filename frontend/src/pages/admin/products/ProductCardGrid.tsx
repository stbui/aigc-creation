import { Coins } from 'lucide-react';
import {
  ActionButton,
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  EmptyState,
  ListError,
  Pagination,
  SelectField,
  Separator,
  SkeletonCards,
  StatusTag,
  ToneBadge,
  formatDateTimeLoose,
} from '~/admin-ui/primitives';
import { cn } from '~/admin-ui/lib/cn';
import { GRANT_TYPE_LABELS, STATUS_LABELS } from './constants';
import { centsToYuanText, validDaysText } from './utils';
import type { AdminProduct } from '../../../types/api';

interface ProductCardGridProps {
  rows: AdminProduct[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  writable: boolean;
  saving: boolean;
  filtered: boolean;
  onClearFilter: () => void;
  onCreate: () => void;
  onEdit: (row: AdminProduct) => void;
  onToggle: (row: AdminProduct) => void;
  pagination: {
    current: number;
    pageSize: number;
    total: number;
    onChange: (page: number, pageSize: number) => void;
  };
}

const PAGE_SIZE_OPTIONS = [20, 50, 100].map((size) => ({
  value: String(size),
  label: String(size),
}));

/** 商品卡片列表：一张卡片对应一个 SKU，保留列表的加载、空态与分页。 */
export function ProductCardGrid({
  rows,
  loading,
  error,
  onRetry,
  writable,
  saving,
  filtered,
  onClearFilter,
  onCreate,
  onEdit,
  onToggle,
  pagination,
}: ProductCardGridProps) {
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
        title={
          filtered
            ? '当前筛选下没有商品。换个关键词或清除筛选看看。'
            : '还没有商品。新建一个积分包，C 端结算页才会出现可购买项。'
        }
        action={
          filtered ? (
            <ActionButton variant="secondary" size="sm" onClick={onClearFilter}>
              清除筛选
            </ActionButton>
          ) : writable ? (
            <ActionButton size="sm" onClick={onCreate}>
              新建商品
            </ActionButton>
          ) : undefined
        }
      />
    );
  }

  return (
    <>
      <div
        data-testid="admin-product-grid"
        aria-busy={loading}
        className={cn(
          'grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4',
          loading && 'opacity-60',
        )}
      >
        {rows.map((row) => (
          <ProductCard
            key={row.id}
            row={row}
            writable={writable}
            saving={saving}
            onEdit={() => onEdit(row)}
            onToggle={() => onToggle(row)}
          />
        ))}
      </div>

      {pagination.total > 0 && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <span className="text-xs text-muted-foreground">
            共 {pagination.total} 个商品
          </span>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              每页
              <SelectField
                className="w-[72px]"
                ariaLabel="每页条数"
                value={String(pagination.pageSize)}
                onChange={(next) => {
                  if (next) pagination.onChange(1, Number(next));
                }}
                options={PAGE_SIZE_OPTIONS}
              />
            </div>
            <Pagination
              page={pagination.current}
              totalPages={Math.max(
                1,
                Math.ceil(pagination.total / pagination.pageSize),
              )}
              onChange={(page) =>
                pagination.onChange(page, pagination.pageSize)
              }
            />
          </div>
        </div>
      )}
    </>
  );
}

function ProductCard({
  row,
  writable,
  saving,
  onEdit,
  onToggle,
}: {
  row: AdminProduct;
  writable: boolean;
  saving: boolean;
  onEdit: () => void;
  onToggle: () => void;
}) {
  const active = row.status === 'active';
  const hasOriginalPrice =
    row.originalPriceCents !== null && row.originalPriceCents > row.priceCents;
  const savingsCents = hasOriginalPrice
    ? (row.originalPriceCents as number) - row.priceCents
    : 0;

  return (
    <Card
      data-testid="admin-product-card"
      data-row-key={row.id}
      data-product-status={row.status}
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
          aria-label={`编辑商品 ${row.name}`}
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
              <Coins className="size-[18px]" strokeWidth={1.8} aria-hidden />
            </span>
            <span className="flex items-baseline gap-1">
              <span
                className={cn(
                  'text-[22px] leading-6 font-bold tabular-nums',
                  active ? 'text-foreground' : 'text-muted-foreground',
                )}
              >
                {row.credits}
              </span>
              <span className="text-[11px] font-medium text-muted-foreground">
                积分
              </span>
            </span>
          </div>
        </div>

        <div className="absolute inset-x-3 top-3 z-10 flex items-start justify-between gap-2">
          <StatusTag
            status={row.status}
            label={STATUS_LABELS[row.status]}
            showDot={active}
          />
          {hasOriginalPrice && (
            <ToneBadge
              tone={active ? 'warn' : 'neutral'}
              className={cn(
                'shrink-0 border px-1.5 text-[11px] shadow-sm',
                active ? 'border-warn-border/60' : 'border-border/60',
              )}
            >
              省 ¥{centsToYuanText(savingsCents)}
            </ToneBadge>
          )}
        </div>
      </div>

      <CardHeader className="pointer-events-none px-4 pt-3 pb-2.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="truncate text-[15px] leading-5 font-semibold">
              {row.name}
            </CardTitle>
            <code className="mt-1 block truncate font-mono text-[11px] text-muted-foreground">
              {row.sku}
            </code>
          </div>
          <span
            className={cn(
              'shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-medium',
              active
                ? 'bg-accent text-accent-foreground'
                : 'bg-muted text-muted-foreground',
            )}
          >
            {GRANT_TYPE_LABELS[row.grantType]}
          </span>
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
                {centsToYuanText(row.priceCents)}
              </span>
            </div>
            {hasOriginalPrice ? (
              <div className="mt-0.5 text-[11px] text-muted-foreground">
                原价{' '}
                <span className="tabular-nums line-through">
                  ¥{centsToYuanText(row.originalPriceCents as number)}
                </span>
              </div>
            ) : (
              <div className="mt-0.5 text-[11px] text-muted-foreground">
                统一售价
              </div>
            )}
          </div>
          <div className="rounded-lg bg-muted/60 px-2 py-1.5 text-right">
            <div className="text-[10px] text-muted-foreground">有效期</div>
            <div
              className={cn(
                'mt-0.5 whitespace-nowrap text-[12px] font-semibold',
                active ? 'text-foreground' : 'text-muted-foreground',
              )}
            >
              {validDaysText(row.creditsValidDays)}
            </div>
          </div>
        </div>

        {row.description && (
          <p className="mt-2.5 truncate text-[12px] leading-4 text-muted-foreground">
            {row.description}
          </p>
        )}

        <div className="mt-auto flex items-center justify-between gap-2 pt-2.5 text-[11px] text-muted-foreground">
          <span>排序 {row.sortOrder}</span>
          <span className="truncate">
            更新于 {formatDateTimeLoose(row.updatedAt)}
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
              'relative z-20 flex items-center justify-end gap-1 px-2 py-1.5',
              active ? 'bg-muted/20' : 'bg-muted/45',
            )}
          >
            <ActionButton variant="ghost" size="sm" onClick={onEdit}>
              编辑
            </ActionButton>
            <ActionButton
              variant="ghost"
              size="sm"
              className={cn(
                row.status === 'active' &&
                  'text-danger-text hover:text-danger-text',
              )}
              disabled={saving}
              onClick={onToggle}
            >
              {row.status === 'active' ? '下架' : '上架'}
            </ActionButton>
          </CardFooter>
        </>
      )}
    </Card>
  );
}
