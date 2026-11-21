import { Clock3 } from 'lucide-react';

import type { Product } from '../../types/api';
import { PACK_FILTERS, type PackCounts, type PackFilter } from './constants';
import { formatNumber, formatPerCredit, formatYuan } from './utils';
import { Button } from './components';

interface PackagesProductSectionProps {
  /** 当前筛选下展示的积分包 */
  products: Product[];
  counts: PackCounts;
  bestValueId: string | null;
  filter: PackFilter;
  onFilterChange: (filter: PackFilter) => void;
  onBuy: (product: Product) => void;
}

/** 积分包：弹性行，每张卡 208px 起伸展，窄屏两列并排 */
const PACK_CARD =
  'relative flex min-w-0 max-w-[280px] flex-[1_1_208px] flex-col gap-3 rounded-xl border border-border bg-card px-5 pt-[22px] pb-5 transition-[box-shadow,transform] ' +
  '[@media(hover:hover)]:hover:-translate-y-0.5 [@media(hover:hover)]:hover:shadow-[0_10px_26px_rgba(34,41,67,0.08)] ' +
  'max-[640px]:max-w-none max-[640px]:flex-[0_0_calc(50%_-_6px)] max-[640px]:gap-2.5 max-[640px]:px-3 max-[640px]:pt-4 max-[640px]:pb-3.5';

/** 商品数为奇数时，末张占满整行 —— 半张卡悬在中间比落单更难解释 */
const PACK_CARD_LAST_ODD = 'max-[640px]:odd:last:flex-[0_0_100%]';

/** 积分包：有效期筛选 + 商品卡。 */
export function PackagesProductSection({
  products,
  counts,
  bestValueId,
  filter,
  onFilterChange,
  onBuy,
}: PackagesProductSectionProps) {
  return (
    <section className="mb-[30px]">
      <div className="mb-3.5 flex flex-wrap items-end justify-between gap-x-5 gap-y-1.5">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="m-0 text-[17px] leading-6 font-bold text-foreground">积分包</h2>
          <p className="m-0 text-[13px] leading-5 text-[color:var(--text-muted)]">
            一次性购买，按需补充；积分有效期以卡片标注为准
          </p>
        </div>
        {/* 只展示真实存在分类的筛选项: 永远给一个点开是空列表的按钮没有意义 */}
        <div
          className="inline-flex shrink-0 gap-1 rounded-full bg-muted p-[3px]"
          role="group"
          aria-label="按有效期筛选"
        >
          {PACK_FILTERS.filter((entry) => counts[entry.key] > 0).map((entry) => {
            const active = filter === entry.key;
            return (
              <button
                key={entry.key}
                type="button"
                aria-pressed={active}
                className={`inline-flex cursor-pointer items-center gap-[5px] rounded-full px-3 py-[5px] text-xs leading-[18px] font-semibold transition-colors ${
                  active
                    ? 'bg-card text-brand shadow-[0_1px_3px_rgba(34,41,67,0.1)]'
                    : 'text-[color:var(--text-muted)] hover:text-foreground'
                }`}
                onClick={() => onFilterChange(entry.key)}
              >
                {entry.label}
                <span
                  className={`text-xs font-medium tabular-nums ${
                    active ? 'text-brand' : 'text-[color:var(--text-desc)]'
                  }`}
                >
                  {counts[entry.key]}
                </span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="flex flex-wrap justify-center gap-4 max-[640px]:gap-3">
        {products.map((product) => (
          <article
            key={product.id}
            className={`${PACK_CARD} ${products.length % 2 === 1 ? PACK_CARD_LAST_ODD : ''}`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-[15px] leading-5 font-bold text-foreground [overflow-wrap:anywhere] max-[640px]:text-sm">
                {product.name}
              </span>
              {product.isFree ? (
                <span className="shrink-0 rounded-full bg-success-soft px-2 py-0.5 text-xs leading-4 font-semibold whitespace-nowrap text-success-text">
                  免费
                </span>
              ) : (
                product.id === bestValueId && (
                  <span className="shrink-0 rounded-full bg-warn-soft px-2 py-0.5 text-xs leading-4 font-semibold whitespace-nowrap text-warn-text">
                    最划算
                  </span>
                )
              )}
            </div>

            <div className="flex items-baseline gap-[5px] text-brand">
              <strong className="text-[28px] leading-[34px] font-bold tracking-[-0.5px] tabular-nums max-[640px]:text-[22px] max-[640px]:leading-7">
                {formatNumber(product.credits)}
              </strong>
              <span className="text-xs text-[color:var(--text-muted)]">积分</span>
            </div>

            {/* 有效期来自 SKU 而非写死; 折合单价由价格 / 积分算出, 不写进商品文案 */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
              <span className="inline-flex items-center gap-[5px] text-xs leading-[18px] text-[color:var(--text-muted)]">
                <Clock3 size={13} className="shrink-0 text-[color:var(--text-desc)]" aria-hidden />
                {product.creditsValidDays > 0 ? `${product.creditsValidDays} 天内有效` : '永久有效'}
              </span>
              {formatPerCredit(product) && (
                <span className="text-xs leading-[18px] tabular-nums text-[color:var(--text-desc)]">
                  折合 {formatPerCredit(product)} / 分
                </span>
              )}
            </div>

            {product.description && (
              <p className="m-0 text-xs leading-[18px] text-[color:var(--text-muted)]">
                {product.description}
              </p>
            )}

            <div className="mt-auto flex items-baseline gap-2 border-t border-dashed border-border pt-3.5">
              <strong className="text-xl leading-[26px] font-bold tabular-nums text-foreground max-[640px]:text-[17px]">
                {product.isFree ? '免费' : formatYuan(product.priceCents)}
              </strong>
              {product.originalPriceCents && product.originalPriceCents > product.priceCents && (
                <span className="text-xs line-through text-[color:var(--text-desc)]">
                  {formatYuan(product.originalPriceCents)}
                </span>
              )}
            </div>

            <Button className="h-auto w-full py-2.5 text-[13px] font-semibold" onClick={() => onBuy(product)}>
              {product.isFree ? '免费领取' : '立即购买'}
            </Button>
          </article>
        ))}
      </div>
    </section>
  );
}
