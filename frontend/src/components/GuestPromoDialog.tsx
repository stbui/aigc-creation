import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useCampaignCountdown } from '../hooks/useCampaignCountdown';
import { myMarketingApi } from '../lib/api';
import type { PopupCampaign } from '../types/api';

const DISMISS_KEY = 'ecom-guest-promo-dismissed-v1';
const SHOW_DELAY_MS = 1200;
const FALLBACK_CTA_URL = '/background-remove';

/**
 * 参考站游客首访营销弹层（`.guest-promo-overlay`）的本地化复原。
 *
 * 保留：500×427 构图、遮罩、右上 28px 关闭、倒计时数字块、CTA 热区与入场动画。
 * 改写：参考站的「送 100 积分 / 50 次权益」在本站不存在，注册接口也不发积分；
 * 因此这里只展示真实可兑现的能力（抠图、去水印当前 0 积分）与登录账户能力。
 *
 * 数据口径与顶部 PromoBar 一致：有 DB 活动时标题、CTA、有效期全部取
 * `/marketing/popup`；没有活动时展示静态真实权益，且**不显示倒计时**。
 */
export function GuestPromoDialog() {
  const navigate = useNavigate();
  const { token, loginOpen } = useAuth();
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(DISMISS_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [delayElapsed, setDelayElapsed] = useState(false);
  const [campaign, setCampaign] = useState<PopupCampaign | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setDelayElapsed(true), SHOW_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (dismissed || token) return;
    let alive = true;
    myMarketingApi
      .popup()
      .then((value) => {
        if (alive) setCampaign(value ?? null);
      })
      .catch(() => {
        // 营销位不可用不应阻塞页面；静态权益仍可展示。
        if (alive) setCampaign(null);
      });
    return () => {
      alive = false;
    };
  }, [dismissed, token]);

  const { parts, expired } = useCampaignCountdown(campaign);
  const open = !token && !dismissed && delayElapsed && !loginOpen && !expired;

  const dismiss = useCallback(() => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      /* 隐私模式下写入失败只影响下次访问，不影响本次关闭 */
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') dismiss();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [dismiss, open]);

  if (!open) return null;

  const claim = () => {
    const target = campaign?.ctaUrl;
    const safeTarget = target?.startsWith('/') && !target.startsWith('//') ? target : FALLBACK_CTA_URL;
    dismiss();
    navigate(safeTarget);
  };

  return (
    <div
      className="guest-promo-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) dismiss();
      }}
    >
      <section
        className="guest-promo-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <button
          ref={closeRef}
          type="button"
          className="guest-promo-close"
          aria-label="关闭新人福利"
          onClick={dismiss}
        >
          <X size={15} strokeWidth={2.2} />
        </button>

        <div className="guest-promo-art">
          <img src="/guest-promo/alertbg.webp" alt="" aria-hidden="true" />

          <h2 id={titleId} className="guest-promo-title" title={campaign?.title}>
            {campaign?.title ?? '新用户创作礼'}
          </h2>

          {campaign && parts ? (
            <div className="guest-promo-countdown" aria-label="活动剩余时间">
              {parts.days > 0 && <em className="guest-promo-days">{parts.days}天</em>}
              <span>{parts.hours}</span>
              <b>:</b>
              <span>{parts.minutes}</span>
              <b>:</b>
              <span>{parts.seconds}</span>
              <em>后活动结束</em>
            </div>
          ) : (
            <p className="guest-promo-note">真实权益 · 登录即用</p>
          )}

          <ul className="guest-promo-benefits" aria-label="新人权益">
            <li>一键抠图免费</li>
            <li>一键去水印免费</li>
            <li>作品云端保存</li>
            <li>素材统一管理</li>
          </ul>

          <button type="button" className="guest-promo-claim" onClick={claim}>
            {campaign?.ctaText ?? '免费体验'}
          </button>
        </div>
      </section>
    </div>
  );
}
