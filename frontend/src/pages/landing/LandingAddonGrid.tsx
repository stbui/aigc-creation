import { Link } from 'react-router-dom';

import type { Product } from '../../types/api';
import { formatNumber } from './utils';
import { A, ADDON_ICONS } from './constants';
import type { LandingCatalogState } from './hooks';
import { Button, Card, CardContent } from './components';
import { LandingCatalogEmpty } from './LandingPlanGrid';

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
  return (
    <div className="grid grid-cols-4 gap-4 max-[1080px]:grid-cols-2 max-[640px]:grid-cols-1">
      {state === 'loading' && <LandingCatalogEmpty>积分包加载中…</LandingCatalogEmpty>}
      {state === 'error' && (
        <LandingCatalogEmpty>积分包暂时加载失败，请稍后刷新查看</LandingCatalogEmpty>
      )}
      {state === 'ready' && addons.length === 0 && (
        <LandingCatalogEmpty>暂无可用积分包</LandingCatalogEmpty>
      )}
      {addons.slice(0, 4).map((addon, index) => (
        <Card
          key={addon.id}
          className="items-center gap-0 rounded-xl border-border py-0 text-center transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-brand hover:shadow-card"
        >
          <CardContent className="flex flex-1 flex-col items-center px-5 pt-6 pb-5">
            {ADDON_ICONS[index] && (
              <img
                className="size-10 object-contain"
                src={`${A}/icons/${ADDON_ICONS[index]}.svg`}
                alt=""
                aria-hidden
                loading="lazy"
                decoding="async"
              />
            )}
            <h3 className="mt-3 text-[15px] font-semibold text-foreground">{addon.name}</h3>

            <div className="mt-2 flex items-baseline justify-center gap-0.5 text-foreground">
              {addon.isFree ? (
                <strong className="text-[28px] font-bold">免费</strong>
              ) : (
                <>
                  <span className="text-sm font-bold">¥</span>
                  <strong className="text-[28px] font-bold">
                    {(addon.priceCents / 100).toFixed(2)}
                  </strong>
                  {addon.originalPriceCents && addon.originalPriceCents > addon.priceCents && (
                    <del className="ml-1.5 text-xs text-muted-foreground">
                      ¥{(addon.originalPriceCents / 100).toFixed(2)}
                    </del>
                  )}
                </>
              )}
            </div>

            {/* 可生成张数不写死「积分 ÷ 10」—— 实际每次扣多少以能力消耗价为准,
                与生成页显示的同一个数, 免得两处算法漂移 */}
            <p className="mt-2.5 text-[12.5px] leading-[1.6] text-muted-foreground">
              {formatNumber(addon.credits)} 积分 ·{' '}
              {addon.creditsValidDays > 0 ? `${addon.creditsValidDays} 天内有效` : '永久有效'}
            </p>

            <Button
              asChild
              className="mt-4 w-full rounded-md text-sm font-semibold hover:bg-brand-hover"
            >
              <Link to="/packages">{addon.isFree ? '免费领取' : '立即购买'}</Link>
            </Button>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
