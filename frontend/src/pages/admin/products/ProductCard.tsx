import { CalendarDays } from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  formatNumber,
  ActionButton,
  Card,
  CardFooter,
  Separator,
  StatusTag,
} from '~/admin-ui/primitives';
import { cn } from '~/admin-ui/lib/cn';
import { adminProductOrdersHref } from '../../../lib/admin-links';
import {
  SALE_STATUS_LABELS,
  SALE_STRATEGY_LABELS,
  STATUS_LABELS,
} from './constants';
import {
  currencySymbol,
  moneyText,
  perCreditYuanText,
  saleWindowEnd,
  validDaysText,
} from './utils';
import type { AdminProduct } from '../../../types/api';

/**
 * 商品售卖卡。
 *
 * ## 层级（自上而下只降一档，不抢注意力）
 *
 *   1. 状态与销量 —— 12px 弱信息，决定「能不能卖」和「卖得怎样」；
 *   2. 商品名 —— 16px 半粗，卡片的身份；
 *   3. 数字面板 —— 到账积分是主角，售价作次级；两者用一条发丝线和
 *      「到账积分 / 售价」小标签分层，面板高度不随促销与否变化；
 *   4. 规格行 —— 有效期用「标签 + 值」左右对齐；
 *   5. 动作区 —— 页脚右对齐的次要按钮。
 *
 * ## 质感
 *
 * 在售卡：顶部 2px 品牌渐变线 + 向下淡出的品牌色晕染 + 发丝描边的积分面板，
 * 形成「卡片 → 面板 → 数字」三层表面，不靠重阴影堆叠。
 * 下架卡退到中性灰表面，但数字仍保持可读对比度。
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
export function ProductCard({
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
  const perCredit = perCreditYuanText(row.priceCents, row.credits, row.currency);
  const symbol = currencySymbol(row.currency);
  const saleStatusLabel = SALE_STATUS_LABELS[row.saleStatus];
  // 「已下架」同时出现在状态标签与售卖状态里时只保留一处，避免同一张卡重复报同一件事
  const saleBadgeLabel =
    saleStatusLabel && saleStatusLabel !== STATUS_LABELS[row.status]
      ? saleStatusLabel
      : '';
  // 接口字段缺失时（前后端版本错位）不渲染半截策略行，免得只剩一个孤零零的圆点
  const strategyLabel = SALE_STRATEGY_LABELS[row.saleStrategy];

  return (
    <Card
      data-testid="admin-product-card"
      data-row-key={row.id}
      data-product-status={row.status}
      className={cn(
        'group relative flex h-full flex-col gap-0 overflow-hidden rounded-xl border py-0 transition-[transform,box-shadow,border-color] duration-200',
        active
          ? 'border-border bg-card shadow-card hover:-translate-y-0.5 hover:border-primary/25 hover:shadow-lg'
          : 'border-border/70 bg-muted/20 shadow-none hover:border-border',
      )}
    >
      {/* 顶线：在售卡走品牌渐变，下架卡走中性细线 */}
      <div
        aria-hidden
        className={cn(
          'relative z-20 h-[2px] w-full shrink-0',
          active
            ? 'bg-gradient-to-r from-brand via-brand-light/80 to-brand/0'
            : 'bg-border',
        )}
      />

      {/* 卡面晕染：只在在售卡上，向下淡出，托起顶部信息层 */}
      {active && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-[2px] h-28 bg-gradient-to-b from-brand-bg/55 via-brand-bg/20 to-transparent"
        />
      )}

      {writable && (
        <button
          type="button"
          aria-label={`编辑商品 ${row.name}`}
          className="absolute inset-0 z-10 cursor-pointer rounded-xl outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          onClick={onEdit}
        />
      )}

      {/* 身份区：状态 + 销量 + 名称 + 说明 */}
      <div className="pointer-events-none relative z-10 px-4 pt-3">
        <div className="flex items-center justify-between gap-2">
          <StatusTag
            status={row.status}
            label={STATUS_LABELS[row.status]}
            showDot={active}
          />
          <div className="flex shrink-0 items-center gap-2">
            {/*
             * 历史订单数直接摆出来，而不是等点「删除」才用弹窗告知：
             * 运营一眼就能分清哪些商品真的卖过、哪些卖不动，也解释了
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
                className="pointer-events-auto rounded text-[12px] leading-4 tabular-nums text-muted-foreground transition-colors hover:text-brand hover:underline"
                title={`查看「${row.name}」的 ${row.orderCount} 笔历史订单`}
                onClick={(event) => event.stopPropagation()}
              >
                {row.orderCount} 单
              </Link>
            )}
            {saleBadgeLabel && (
              <span className="rounded-sm border border-warn-border bg-warn-soft px-1.5 py-0.5 text-[12px] leading-4 whitespace-nowrap text-warn-text">
                {saleBadgeLabel}
              </span>
            )}
          </div>
        </div>

        <h3
          className="mt-3 truncate text-[16px] leading-6 font-semibold tracking-[-0.01em] text-foreground"
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

      {/* 数字面板：到账积分是主角，售价是次级，一条发丝线把两级分开 */}
      <div className="pointer-events-none relative z-10 mt-auto px-4 pt-4">
        <div
          className={cn(
            'overflow-hidden rounded-lg border',
            active
              ? 'border-brand/15 bg-gradient-to-br from-brand-bg/75 via-brand-bg/35 to-card'
              : 'border-border/60 bg-card/70',
          )}
        >
          <div className="flex items-start justify-between gap-2 px-3.5 pt-3">
            <div className="min-w-0">
              <div className="text-[12px] leading-4 text-muted-foreground">
                到账积分
              </div>
              <div className="mt-1 flex items-baseline gap-1.5">
                <span
                  className={cn(
                    'truncate text-[28px] leading-none font-bold tracking-tight tabular-nums',
                    active ? 'text-foreground' : 'text-muted-foreground',
                  )}
                >
                  {formatNumber(row.credits)}
                </span>
                <span className="text-[12px] leading-4 text-muted-foreground">
                  积分
                </span>
              </div>
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
                省 {symbol}{moneyText(savingsCents)}
              </span>
            )}
          </div>

          {/*
           * 售价与折合信息：左侧价格、右侧划线价与单价，底边对齐。
           * 右侧两行都缺时按「免费」或「不计积分」收尾，**不放占位词** ——
           * 「统一售价」这类空话会让人以为漏了信息。面板高度由左侧价格行决定，
           * 不随是否有划线价变化。
           */}
          <div
            className={cn(
              'mt-3 flex items-end justify-between gap-3 border-t px-3.5 pt-2.5 pb-3',
              active ? 'border-brand/12' : 'border-border/60',
            )}
          >
            <div className="min-w-0">
              <div className="text-[12px] leading-4 text-muted-foreground">
                售价
              </div>
              <div
                className={cn(
                  'mt-1 flex items-baseline gap-0.5',
                  active ? 'text-brand' : 'text-muted-foreground',
                )}
              >
                <span className="text-[13px] leading-none font-semibold">{symbol}</span>
                <span className="truncate text-[22px] leading-none font-bold tracking-tight tabular-nums">
                  {moneyText(row.priceCents)}
                </span>
              </div>
            </div>
            <div className="shrink-0 text-right text-[12px] leading-4 text-muted-foreground tabular-nums">
              {hasOriginalPrice && (
                <div>
                  原价{' '}
                  <span className="line-through">
                    {symbol}{moneyText(row.originalPriceCents as number)}
                  </span>
                </div>
              )}
              <div className={cn(hasOriginalPrice && 'mt-0.5')}>
                {perCredit
                  ? `折合 ${perCredit} / 分`
                  : row.priceCents > 0
                    ? '不计积分'
                    : '免费'}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 规格区：标签 + 值左右对齐 */}
      <div className="pointer-events-none relative z-10 px-4 pt-3">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={cn(
              'flex size-6 shrink-0 items-center justify-center rounded-md',
              active ? 'bg-brand-bg text-brand' : 'bg-muted text-muted-foreground',
            )}
          >
            <CalendarDays className="size-3.5" strokeWidth={1.7} aria-hidden />
          </span>
          <span className="text-[12px] leading-4 text-muted-foreground">
            有效期
          </span>
          <span className="ml-auto truncate text-[13px] leading-5 font-medium tabular-nums text-foreground">
            {validDaysText(row.creditsValidDays)}
          </span>
        </div>
      </div>

      {/* 策略行：只在非「不限量」时出现，把库存/限购/窗口的实情摆在卡片上 */}
      {row.saleStrategy !== 'unlimited' && strategyLabel && (
        <div className="pointer-events-none relative z-10 mt-1.5 flex min-w-0 items-center gap-1.5 px-4 text-[12px] leading-4 text-muted-foreground">
          <span
            aria-hidden
            className={cn(
              'size-1 shrink-0 rounded-full',
              active ? 'bg-brand/60' : 'bg-muted-foreground/40',
            )}
          />
          <span className="truncate">
            {strategyLabel}
            {row.saleStrategy === 'inventory' && ` · 剩余 ${row.stockRemaining} / ${row.stockTotal}`}
            {row.saleStrategy === 'periodic' &&
              ` · 每 ${row.periodDays} 天限购 ${row.periodPurchaseLimit} 次`}
            {row.saleStrategy === 'timed' && row.saleEndAt && ` · 至 ${saleWindowEnd(row.saleEndAt)}`}
          </span>
        </div>
      )}

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
