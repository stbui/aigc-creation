import './GuestPromoDialog.css';
import { useEffect, useId, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { X } from 'lucide-react';
import { useGuestPromoOffer } from './hooks';

const FALLBACK_CTA_URL = '/background-remove';

/**
 * 游客首访营销弹层。
 *
 * 停留 6 秒且无操作时出现，开始操作即取消本次弹出；数据口径取自弹窗位活动：
 * 有 DB 活动取 `/marketing/popup`，无活动展示静态真实权益且不显示倒计时。
 * 弹出条件、活动数据与关闭持久化由 `useGuestPromoOffer` 托管。
 */
export function GuestPromoDialog() {
  const navigate = useNavigate();
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const { open, campaign, parts, dismiss } = useGuestPromoOffer();

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        dismiss();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;

      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => element.getClientRects().length > 0);
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !dialogRef.current.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
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
        ref={dialogRef}
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
