import { useNavigate } from 'react-router-dom';

import type { Product } from '../../types/api';
import { A, ADDON_ICONS } from './constants';
import type { LandingCatalogState } from './hooks';

interface LandingAddonGridProps {
  addons: Product[];
  state: LandingCatalogState;
}

/**
 * 积分包网格：首页只陈列前 4 款（一行），全量在 `/packages`。
 *
 * 首页是入口不是价目表，15 张卡会把落地页拉成第二个商城。
 */
export function LandingAddonGrid({ addons, state }: LandingAddonGridProps) {
  const navigate = useNavigate();

  return (
    <div className="lp-addon-grid">
      {state === 'loading' && <p className="lp-empty">积分包加载中…</p>}
      {state === 'error' && <p className="lp-empty">积分包暂时加载失败，请稍后刷新查看</p>}
      {state === 'ready' && addons.length === 0 && <p className="lp-empty">暂无可用积分包</p>}
      {addons.slice(0, 4).map((addon, index) => (
        <article key={addon.id} className="lp-addon-card">
          {ADDON_ICONS[index] && (
            <img
              className="lp-addon-icon"
              src={`${A}/icons/${ADDON_ICONS[index]}.svg`}
              alt=""
              aria-hidden
              loading="lazy"
              decoding="async"
            />
          )}
          <h3>{addon.name}</h3>
          <div className="lp-addon-price">
            {addon.isFree ? (
              <strong>免费</strong>
            ) : (
              <>
                <span className="cur">¥</span>
                <strong>{(addon.priceCents / 100).toFixed(2)}</strong>
                {addon.originalPriceCents && addon.originalPriceCents > addon.priceCents && (
                  <del>¥{(addon.originalPriceCents / 100).toFixed(2)}</del>
                )}
              </>
            )}
          </div>
          {/* 可生成张数不写死「积分 ÷ 10」—— 实际每次扣多少以能力消耗价为准,
              与生成页显示的同一个数, 免得两处算法漂移 */}
          <p className="lp-addon-meta">
            {addon.credits.toLocaleString('zh-CN')} 积分 ·{' '}
            {addon.creditsValidDays > 0 ? `${addon.creditsValidDays} 天内有效` : '永久有效'}
          </p>
          <button type="button" className="lp-plan-buy" onClick={() => navigate('/packages')}>
            {addon.isFree ? '免费领取' : '立即购买'}
          </button>
        </article>
      ))}
    </div>
  );
}
