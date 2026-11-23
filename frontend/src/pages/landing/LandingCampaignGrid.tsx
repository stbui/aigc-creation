import { Link } from 'react-router-dom';

import type { PromoCampaign } from '../../types/api';
import { capabilityName, formatCampaignEnd, toolPath } from './utils';
import { Badge, Button, Card, CardContent } from './components';

interface LandingCampaignGridProps {
  campaigns: PromoCampaign[];
}

/**
 * 限时活动网格：全部来自后台「限时活动」配置（`GET /marketing/campaigns`）。
 *
 * 过期 / 下架商品 / 活动价不低于原价的活动后端已过滤，这里不做二次判断 ——
 * 展示层再算一遍价格就会出现「页面写 9.9、结算收 19.9」。
 */
export function LandingCampaignGrid({ campaigns }: LandingCampaignGridProps) {
  return (
    <div className="grid grid-cols-4 gap-4 max-[1080px]:grid-cols-2 max-[640px]:grid-cols-1">
      {campaigns.map((campaign) => {
        const firstCapability = campaign.capabilityIds?.[0];
        const freeTarget = firstCapability ? toolPath(firstCapability) : '/workbench';
        return campaign.type === 'limited_price' &&
          campaign.product &&
          typeof campaign.priceCents === 'number' ? (
          <Card
            key={campaign.id}
            className="relative items-center gap-0 rounded-xl border-[color-mix(in_srgb,var(--brand)_22%,var(--border))] py-0 text-center transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-brand hover:shadow-card"
          >
            <Badge className="absolute top-3 left-3 h-auto rounded-full px-2.5 py-0.5 text-xs font-semibold">
              限时价
            </Badge>
            <CardContent className="flex flex-1 flex-col items-center px-5 pt-6 pb-5">
              <h3 className="mt-3 text-[15px] font-semibold text-foreground">
                {campaign.product.name}
              </h3>
              <div className="mt-2 flex items-baseline justify-center gap-0.5 text-foreground">
                <span className="text-sm font-bold">¥</span>
                <strong className="text-[28px] font-bold">
                  {(campaign.priceCents / 100).toFixed(2)}
                </strong>
                <del className="ml-1.5 text-xs text-muted-foreground">
                  ¥{(campaign.product.priceCents / 100).toFixed(2)}
                </del>
              </div>
              <p className="mt-2.5 text-[12.5px] leading-[1.6] text-muted-foreground">
                {campaign.name} · {formatCampaignEnd(campaign.endAt)}结束
              </p>
              <Button
                asChild
                className="mt-4 w-full rounded-md text-sm font-semibold hover:bg-brand-hover"
              >
                <Link to={`/checkout/${encodeURIComponent(campaign.product!.sku)}`}>立即抢购</Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <Card
            key={campaign.id}
            className="relative items-center gap-0 rounded-xl border-[color-mix(in_srgb,var(--brand)_22%,var(--border))] py-0 text-center transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-brand hover:shadow-card"
          >
            <Badge className="absolute top-3 left-3 h-auto rounded-full px-2.5 py-0.5 text-xs font-semibold">
              限时免费
            </Badge>
            <CardContent className="flex flex-1 flex-col items-center px-5 pt-6 pb-5">
              <h3 className="mt-3 text-[15px] font-semibold text-foreground">{campaign.name}</h3>
              <div className="mt-2 flex items-baseline justify-center gap-0.5 text-foreground">
                <strong className="text-[28px] font-bold">
                  {campaign.onlyNewUsers ? '新客' : '0'}
                </strong>
                <span className="text-sm font-bold">{campaign.onlyNewUsers ? '专享' : '积分'}</span>
              </div>
              <p className="mt-2.5 text-[12.5px] leading-[1.6] text-muted-foreground">
                {(campaign.capabilityIds ?? []).map((id) => capabilityName(id)).join(' / ')}
                <br />
                {campaign.onlyNewUsers ? '仅限新用户，登录后按资格生效 · ' : ''}
                {formatCampaignEnd(campaign.endAt)}结束
              </p>
              <Button
                asChild
                className="mt-4 w-full rounded-md text-sm font-semibold hover:bg-brand-hover"
              >
                <Link to={freeTarget}>去使用</Link>
              </Button>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
