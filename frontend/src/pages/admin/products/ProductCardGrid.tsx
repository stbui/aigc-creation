import { CalendarDays, HandCoins } from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  ActionButton,
  Card,
  CardFooter,
  EmptyState,
  ListError,
  Pagination,
  SelectField,
  Separator,
  SkeletonCards,
  StatusTag,
} from '~/admin-ui/primitives';
import { cn } from '~/admin-ui/lib/cn';
import { adminProductOrdersHref } from '../../../lib/admin-links';
import { GRANT_TYPE_LABELS, STATUS_LABELS } from './constants';
import {
  centsToYuanText,
  perCreditYuanText,
  validDaysText,
} from './utils';
import type { AdminProduct } from '../../../types/api';

interface ProductCardGridProps {
  rows: AdminProduct[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  writable: boolean;
  /** 有 `product.delete` 才出现删除按钮；有历史订单时由页面拦下并提示改为下架 */
  deletable: boolean;
  saving: boolean;
  filtered: boolean;
  onClearFilter: () => void;
  onCreate: () => void;
  onEdit: (row: AdminProduct) => void;
  onToggle: (row: AdminProduct) => void;
  onDelete: (row: AdminProduct) => void;
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
  deletable,
  saving,
  filtered,
  onClearFilter,
  onCreate,
  onEdit,
  onToggle,
  onDelete,
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
            deletable={deletable}
            saving={saving}
            onEdit={() => onEdit(row)}
            onToggle={() => onToggle(row)}
            onDelete={() => onDelete(row)}
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
 * ## 层级（自上而下只降一档，不抢注意力）
 *
 *   1. 商品名 —— 这是卡片的身份，一眼能认出是哪个 SKU；
 *   2. 数字区 —— 积分是主角（与 C 端商品卡同一口径），售价作次级，
 *      两者放在**同一块底色面板**里，避免分成两块后像两张卡拼接；
 *      面板恒为三行（积分 / 售价 / 划线价·折合单价），高度不随促销与否变化；
 *   3. 规格区 —— 有效期 / 发放方式两栏对齐，弱化到只有字重差别；
 *   4. 动作区 —— 页脚右对齐的次要按钮。
 *
 * 促销徽标放在面板首行右侧与积分同排，而不是压在售价下面：既填满右半侧，
 * 又不给面板多出一行 —— 条件渲染的行会让同排卡片的面板高度参差。
 *
 * SKU 编码是内部标识（对账靠它），不参与视觉竞争，收成 12px 等宽字。
 *
 * ## 在售与下架
 *
 * 在售卡用品牌渐变顶线 + 品牌淡底面板；下架卡顶线走中性灰、面板走白底，
 * 整体退到背景里，但不整片变灰 —— 变灰会让数字读不出来。
 *
 * ## 删除
 *
 * 只有从没卖出去过的 SKU 能真正删除。已有历史订单的卡片照样显示按钮，
 * 点下去由页面提示「改为下架」—— 直接隐藏会让运营猜不出这张卡为什么少一个动作。
 * 按钮静息态与下架一致：次要色，悬停才转危险色。
 */
function ProductCard({
  row,
  writable,
  deletable,
  saving,
  onEdit,
  onToggle,
  onDelete,
}: {
  row: AdminProduct;
  writable: boolean;
  deletable: boolean;
  saving: boolean;
  onEdit: () => void;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const active = row.status === 'active';
  const hasOriginalPrice =
    row.originalPriceCents !== null && row.originalPriceCents > row.priceCents;
  const savingsCents = hasOriginalPrice
    ? (row.originalPriceCents as number) - row.priceCents
    : 0;
  const perCredit = perCreditYuanText(row.priceCents, row.credits);

  return (
    <Card
      data-testid="admin-product-card"
      data-row-key={row.id}
      data-product-status={row.status}
      className={cn(
        'group relative flex h-full flex-col gap-0 overflow-hidden rounded-xl border py-0 transition-all duration-200',
        active
          ? 'border-border bg-card shadow-card hover:-translate-y-0.5 hover:border-primary/25 hover:shadow-lg'
          : 'border-border/70 bg-muted/25 shadow-none hover:border-border',
      )}
    >
      {/* 顶线：在售卡走品牌渐变，下架卡走中性细线 */}
      <div
        aria-hidden
        className={cn(
          'h-[3px] w-full shrink-0',
          active
            ? 'bg-gradient-to-r from-brand via-brand-light to-brand/25'
            : 'bg-border',
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

      {/* 身份区：编码 + 订单量 + 状态 + 名称 + 说明 */}
      <div className="pointer-events-none relative z-10 px-4 pt-3">
        <div className="flex items-center justify-between gap-2">
          <code
            className="truncate font-mono text-[12px] leading-4 tracking-[0.04em] text-muted-foreground"
            title={row.sku}
          >
            {row.sku}
          </code>
          <div className="flex shrink-0 items-center gap-2">
            {/*
             * 历史订单数直接摆出来，而不是等点「删除」才用弹窗告知：
             * 运营一眼就能分清哪些 SKU 真的卖过、哪些卖不动，也解释了
             * 为什么这几张卡的删除会被拒。0 单不渲染，免得整墙都是「0 单」。
             *
             * 数字本身是链接，直达该商品的订单明细 —— 「卖了多少」的下一步
             * 永远是「是哪几单」。用 Link 而非按钮：这是导航，不是写操作。
             */}
            {row.orderCount > 0 && (
              <Link
                to={adminProductOrdersHref(row.id, row.name)}
                // 身份区整体是 pointer-events-none（点击走卡片上的整块遮罩打开编辑），
                // 链接要单独恢复，否则点不动。
                className="pointer-events-auto rounded text-[12px] leading-4 tabular-nums text-muted-foreground hover:text-brand hover:underline"
                title={`查看「${row.name}」的 ${row.orderCount} 笔历史订单`}
                onClick={(event) => event.stopPropagation()}
              >
                {row.orderCount} 单
              </Link>
            )}
            <StatusTag
              status={row.status}
              label={STATUS_LABELS[row.status]}
              showDot={active}
            />
          </div>
        </div>

        <h3
          className="mt-2.5 truncate text-[15px] leading-6 font-semibold text-foreground"
          title={row.name}
        >
          {row.name}
        </h3>
        <p
          className="mt-1 line-clamp-2 min-h-9 text-[12px] leading-[18px] text-muted-foreground"
          title={row.description || undefined}
        >
          {row.description || '暂无商品说明'}
        </p>
      </div>

      {/* 数字区：积分为主角、售价作次级，同处一块面板 */}
      <div className="pointer-events-none relative z-10 mt-auto px-4 pt-3">
        <div
          className={cn(
            'rounded-lg px-3 py-2.5',
            active ? 'bg-brand-bg/55' : 'bg-card/80',
          )}
        >
          {/* 首行左右各占一边：积分靠左镇场，促销徽标靠右收口 */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-baseline gap-1.5">
              <span
                className={cn(
                  'truncate text-[28px] leading-none font-bold tracking-tight tabular-nums',
                  active ? 'text-foreground' : 'text-muted-foreground',
                )}
              >
                {row.credits.toLocaleString('zh-CN')}
              </span>
              <span className="text-[12px] leading-4 text-muted-foreground">
                积分
              </span>
            </div>
            {hasOriginalPrice && (
              <span
                className={cn(
                  'shrink-0 rounded-sm border px-1.5 py-0.5 text-[12px] leading-4 tabular-nums',
                  active
                    ? 'border-warn-border bg-warn-soft text-warn-text'
                    : 'border-border bg-muted text-muted-foreground',
                )}
              >
                省 ¥{centsToYuanText(savingsCents)}
              </span>
            )}
          </div>

          <div
            className={cn(
              'mt-2.5 flex items-baseline gap-0.5 border-t pt-2.5',
              active
                ? 'border-brand/15 text-brand'
                : 'border-border/60 text-muted-foreground',
            )}
          >
            <span className="text-[14px] leading-none font-semibold">¥</span>
            <span className="truncate text-[22px] leading-none font-bold tracking-tight tabular-nums">
              {centsToYuanText(row.priceCents)}
            </span>
          </div>

          {/*
           * 底行恒占一行：划线价与折合单价同处一行，两者都缺时按「免费」或
           * 「不计积分」收尾。**不放占位词** —— 「统一售价」这类空话会让人以为
           * 漏了信息。行高恒定，保证同排卡片的售价基线、面板底边、规格行全部对齐。
           */}
          <div className="mt-1.5 flex min-h-5 items-baseline gap-2">
            {hasOriginalPrice && (
              <span className="shrink-0 text-[12px] leading-4 text-muted-foreground">
                原价{' '}
                <span className="tabular-nums line-through">
                  ¥{centsToYuanText(row.originalPriceCents as number)}
                </span>
              </span>
            )}
            <span className="min-w-0 truncate text-[12px] leading-4 text-muted-foreground tabular-nums">
              {perCredit
                ? `折合 ${perCredit} / 分`
                : row.priceCents > 0
                  ? '不计积分'
                  : '免费'}
            </span>
          </div>
        </div>
      </div>

      {/* 规格区：两栏对齐，只靠字重与留白分层 */}
      <div className="pointer-events-none relative z-10 px-4 pt-3">
        <div className="grid grid-cols-2 divide-x divide-border/60">
          <div className="flex min-w-0 items-center gap-1.5 pr-3">
            <CalendarDays className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.6} aria-hidden />
            <span className="min-w-0 truncate text-[13px] leading-5 font-medium text-foreground">
              {validDaysText(row.creditsValidDays)}
            </span>
          </div>
          <div className="flex min-w-0 items-center gap-1.5 pl-3">
            <HandCoins className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.6} aria-hidden />
            <span className="min-w-0 truncate text-[13px] leading-5 font-medium text-foreground">
              {GRANT_TYPE_LABELS[row.grantType]}
            </span>
          </div>
        </div>
      </div>

      {(writable || deletable) && (
        <>
          <Separator className="mt-3" />
          <CardFooter
            role="group"
            aria-label={`${row.name} 操作`}
            className={cn(
              'relative z-20 flex items-center justify-end gap-1 px-2.5 py-1.5',
              active ? 'bg-card' : 'bg-transparent',
            )}
          >
            {writable && (
              <ActionButton variant="ghost" size="sm" onClick={onEdit}>
                编辑
              </ActionButton>
            )}
            {writable && (
              <ActionButton
                variant="ghost"
                size="sm"
                className={cn(
                  // 下架是破坏性动作，但常驻红字会让整片卡片墙泛红、抢走数字的注意力。
                  // 静息态做成普通次要按钮，悬停才转为危险色 —— 破坏性靠确认弹窗兜底。
                  row.status === 'active' &&
                    'text-muted-foreground hover:bg-danger-soft hover:text-danger-text',
                )}
                disabled={saving}
                onClick={onToggle}
              >
                {row.status === 'active' ? '下架' : '上架'}
              </ActionButton>
            )}
            {deletable && (
              <ActionButton
                variant="ghost"
                size="sm"
                ariaLabel={`删除商品 ${row.name}`}
                className="text-muted-foreground hover:bg-danger-soft hover:text-danger-text"
                disabled={saving}
                onClick={onDelete}
              >
                删除
              </ActionButton>
            )}
          </CardFooter>
        </>
      )}
    </Card>
  );
}
