import { Clock3 } from 'lucide-react';

import type { Product } from '../../types/api';
import { PACK_FILTERS, type PackCounts, type PackFilter } from './constants';
import { formatNumber, formatPerCredit, formatYuan } from './utils';

interface PackagesProductSectionProps {
  /** 当前筛选下展示的积分包 */
  products: Product[];
  counts: PackCounts;
  bestValueId: string | null;
  filter: PackFilter;
  onFilterChange: (filter: PackFilter) => void;
  onBuy: (product: Product) => void;
}

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
    <section className="pkg-section">
      <div className="pkg-section-head">
        <div className="pkg-section-copy">
          <h2>积分包</h2>
          <p>一次性购买，按需补充；积分有效期以卡片标注为准</p>
        </div>
        {/* 只展示真实存在分类的筛选项: 永远给一个点开是空列表的按钮没有意义 */}
        <div className="pkg-filter" role="group" aria-label="按有效期筛选">
          {PACK_FILTERS.filter((entry) => counts[entry.key] > 0).map((entry) => (
            <button
              key={entry.key}
              type="button"
              aria-pressed={filter === entry.key}
              className={`pkg-filter-btn${filter === entry.key ? ' is-active' : ''}`}
              onClick={() => onFilterChange(entry.key)}
            >
              {entry.label}
              <span>{counts[entry.key]}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="pkg-grid is-products">
        {products.map((product) => (
          <article key={product.id} className="pkg-card">
            <div className="pkg-card-top">
              <span className="pkg-card-name">{product.name}</span>
              {product.isFree ? (
                <span className="pkg-card-badge is-free">免费</span>
              ) : (
                product.id === bestValueId && <span className="pkg-card-badge is-hot">最划算</span>
              )}
            </div>

            <div className="pkg-card-points">
              <strong>{formatNumber(product.credits)}</strong>
              <span>积分</span>
            </div>

            {/* 有效期来自 SKU 而非写死; 折合单价由价格 / 积分算出, 不写进商品文案 */}
            <div className="pkg-card-meta">
              <span className="pkg-card-validity">
                <Clock3 size={13} aria-hidden />
                {product.creditsValidDays > 0 ? `${product.creditsValidDays} 天内有效` : '永久有效'}
              </span>
              {formatPerCredit(product) && (
                <span className="pkg-card-unit">折合 {formatPerCredit(product)} / 分</span>
              )}
            </div>

            {product.description && <p className="pkg-card-desc">{product.description}</p>}

            <div className="pkg-card-price">
              <strong>{product.isFree ? '免费' : formatYuan(product.priceCents)}</strong>
              {product.originalPriceCents && product.originalPriceCents > product.priceCents && (
                <span className="pkg-card-price-old">{formatYuan(product.originalPriceCents)}</span>
              )}
            </div>

            <button type="button" className="pkg-select-btn" onClick={() => onBuy(product)}>
              {product.isFree ? '免费领取' : '立即购买'}
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}
