import { useNavigate } from 'react-router-dom';

import type { PromoCampaign } from '../../types/api';
import { capabilityName, formatCampaignEnd, toolPath } from './utils';

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
  const navigate = useNavigate();

  return (
    <div className="lp-addon-grid">
      {campaigns.map((campaign) =>
        campaign.type === 'limited_price' &&
        campaign.product &&
        typeof campaign.priceCents === 'number' ? (
          <article key={campaign.id} className="lp-addon-card is-campaign">
            <span className="lp-campaign-tag">限时价</span>
            <h3>{campaign.product.name}</h3>
            <div className="lp-addon-price">
              <span className="cur">¥</span>
              <strong>{(campaign.priceCents / 100).toFixed(2)}</strong>
              <del>¥{(campaign.product.priceCents / 100).toFixed(2)}</del>
            </div>
            <p className="lp-addon-meta">
              {campaign.name} · {formatCampaignEnd(campaign.endAt)}结束
            </p>
            <button
              type="button"
              className="lp-plan-buy"
              onClick={() => navigate(`/checkout/${encodeURIComponent(campaign.product!.sku)}`)}
            >
              立即抢购
            </button>
          </article>
        ) : (
          <article key={campaign.id} className="lp-addon-card is-campaign">
            <span className="lp-campaign-tag">限时免费</span>
            <h3>{campaign.name}</h3>
            <div className="lp-addon-price">
              <strong>{campaign.onlyNewUsers ? '新客' : '0'}</strong>
              <span>{campaign.onlyNewUsers ? '专享' : '积分'}</span>
            </div>
            <p className="lp-addon-meta">
              {(campaign.capabilityIds ?? []).map((id) => capabilityName(id)).join(' / ')}
              <br />
              {campaign.onlyNewUsers ? '仅限新用户，登录后按资格生效 · ' : ''}
              {formatCampaignEnd(campaign.endAt)}结束
            </p>
            <button
              type="button"
              className="lp-plan-buy"
              onClick={() => {
                const first = campaign.capabilityIds?.[0];
                navigate(first ? toolPath(first) : '/workbench');
              }}
            >
              去使用
            </button>
          </article>
        ),
      )}
    </div>
  );
}
