import { CalendarDays, Coins } from 'lucide-react';
import {
  ActionButton,
  Card,
  CardContent,
  CardFooter,
  EmptyState,
  ListError,
  Pagination,
  SelectField,
  Separator,
  SkeletonCards,
  StatusTag,
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

/**
 * 商品售卖卡。
 *
 * 走「轻奢商品陈列」的路子：大留白、细描边、弱化饱和色，用积分数字做主视觉。
 * 层级从强到弱：积分 → 售价 → 有效期与发放方式 → 编码 / 排序 / 更新时间。
 * 在售卡保留品牌淡晕与徽章；下架卡整体转灰，避免和可售商品抢注意力。
 */
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
        'group relative flex h-full flex-col gap-0 overflow-hidden rounded-xl border py-0 transition-all duration-200',
        active
          ? 'border-border bg-card shadow-card hover:-translate-y-0.5 hover:border-primary/25 hover:shadow-lg'
          : 'border-border/70 bg-muted/20 shadow-none hover:border-border',
      )}
    >
      {/* 卡面淡晕：只在售卡有，像商品陈列柜里的柔光 */}
      <div
        aria-hidden
        className={cn(
          'pointer-events-none absolute inset-x-0 top-0 h-40',
          active
            ? 'bg-gradient-to-b from-brand-bg/55 via-brand-bg/15 to-transparent'
            : 'bg-gradient-to-b from-muted/50 to-transparent',
        )}
      />

      {writable && (
        <button
          type="button"
          aria-label={`编辑商品 ${row.name}`}
          className="absolute inset-0 z-10 cursor-pointer rounded-xl outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          onClick={onEdit}
        />
      )}

      <div className="pointer-events-none relative z-10 flex items-center justify-between gap-2 px-4 pt-3">
        <code
          className="truncate font-mono text-[12px] leading-4 tracking-[0.04em] text-muted-foreground"
          title={row.sku}
        >
          {row.sku}
        </code>
        <StatusTag
          status={row.status}
          label={STATUS_LABELS[row.status]}
          showDot={active}
        />
      </div>

      <div className="pointer-events-none relative z-10 px-4 pt-2.5">
        <h3 className="truncate text-[17px] leading-6 font-semibold text-foreground">
          {row.name}
        </h3>
        <p
          className="mt-1 line-clamp-2 min-h-9 text-[12px] leading-[18px] text-muted-foreground"
          title={row.description || undefined}
        >
          {row.description || '暂无商品说明'}
        </p>
      </div>

      <CardContent className="pointer-events-none relative z-10 flex flex-1 flex-col px-4 pt-4 pb-3">
        {/* 主视觉：积分数量 + 徽章式圆章 */}
        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-baseline gap-1.5">
              <span
                className={cn(
                  'truncate text-[34px] leading-none font-normal tracking-tight tabular-nums',
                  active ? 'text-foreground' : 'text-muted-foreground',
                )}
              >
                {row.credits.toLocaleString('zh-CN')}
              </span>
              <span className="text-[12px] leading-4 text-muted-foreground">
                积分
              </span>
            </div>
            <div className="mt-2 flex items-center gap-1.5 text-[12px] leading-4 text-muted-foreground">
              <CalendarDays className="size-3.5" strokeWidth={1.6} aria-hidden />
              <span>有效期 · {validDaysText(row.creditsValidDays)}</span>
            </div>
          </div>
          <div
            aria-hidden
            className={cn(
              'relative flex size-14 shrink-0 items-center justify-center rounded-full border',
              active
                ? 'border-primary/15 bg-card/80'
                : 'border-border/70 bg-card/50',
            )}
          >
            <span
              className={cn(
                'absolute inset-1.5 rounded-full border',
                active ? 'border-primary/10' : 'border-border/60',
              )}
            />
            <Coins
              className={cn(
                'size-5',
                active ? 'text-brand' : 'text-muted-foreground',
              )}
              strokeWidth={1.5}
            />
          </div>
        </div>

        {/* 售价：品牌色数字压住第二层级 */}
        <div className="mt-4 border-t border-border/70 pt-3">
          <div className="flex items-end justify-between gap-2">
            <div className="min-w-0">
              <div
                className={cn(
                  'flex items-baseline gap-1',
                  active ? 'text-brand' : 'text-muted-foreground',
                )}
              >
                <span className="text-[14px] font-semibold">¥</span>
                <span className="truncate text-[26px] leading-none font-bold tracking-tight tabular-nums">
                  {centsToYuanText(row.priceCents)}
                </span>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] leading-4 text-muted-foreground">
                {hasOriginalPrice ? (
                  <>
                    <span>
                      原价{' '}
                      <span className="tabular-nums line-through">
                        ¥{centsToYuanText(row.originalPriceCents as number)}
                      </span>
                    </span>
                    <span
                      className={cn(
                        'rounded-sm border px-1.5 py-0.5',
                        active
                          ? 'border-warn-border bg-warn-soft text-warn-text'
                          : 'border-border bg-muted text-muted-foreground',
                      )}
                    >
                      省 ¥{centsToYuanText(savingsCents)}
                    </span>
                  </>
                ) : (
                  <span>统一售价</span>
                )}
              </div>
            </div>
            <span
              className={cn(
                'shrink-0 rounded-md border px-2 py-1 text-[12px] leading-4',
                active
                  ? 'border-border bg-card/80 text-muted-foreground'
                  : 'border-border/70 text-muted-foreground',
              )}
            >
              {GRANT_TYPE_LABELS[row.grantType]}
            </span>
          </div>
        </div>

        <div className="mt-auto flex items-center justify-between gap-2 border-t border-border/70 pt-2.5 text-[12px] leading-4 text-muted-foreground">
          <span className="tabular-nums">排序 {row.sortOrder}</span>
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
              'relative z-20 flex items-center justify-end gap-1 px-2.5 py-1.5',
              active ? 'bg-card' : 'bg-transparent',
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
