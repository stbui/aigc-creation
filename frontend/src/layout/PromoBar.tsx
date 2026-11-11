import { useNavigate } from 'react-router-dom';
import { Gift, X } from 'lucide-react';
import { safeInternalPath } from '../lib/safePath';
import { usePromoBar } from './hooks';

/**
 * 顶部推广条。
 *
 * 有 DB 活动（GET /marketing/popup）时使用服务端文案与倒计时；无活动时回落静态
 * 卖点条且不显示倒计时。状态与高度契约由 `usePromoBar` 托管。
 */
export function PromoBar() {
  const navigate = useNavigate();
  const { hidden, campaign, remainText, dismiss } = usePromoBar();

  if (hidden) return null;

  const goCampaign = () => {
    // 再兜一层站内路径校验，拒绝被绕过的站外地址
    navigate(safeInternalPath(campaign?.ctaUrl, '/packages'));
  };

  return (
    <div className="app-promo">
      <div className="app-promo-inner">
        <span className="app-promo-badge">
          <Gift size={13} />
          {campaign ? '限时活动' : '货觉新人礼'}
        </span>
        <span className="app-promo-text">
          {campaign
            ? `${campaign.title}${campaign.body ? ` · ${campaign.body}` : ''}`
            : '上传商品图，一键生成主图、详情与营销素材'}
          {campaign && remainText ? ` · 剩余 ${remainText}` : ''}
        </span>
        <button type="button" className="app-promo-cta" onClick={goCampaign}>
          {campaign?.ctaText ?? '立即体验'}
        </button>
      </div>
      <button
        type="button"
        className="app-promo-close"
        aria-label="关闭推广"
        onClick={dismiss}
      >
        <X size={14} />
      </button>
    </div>
  );
}
