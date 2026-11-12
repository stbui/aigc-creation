import { Image as ImageIcon, Link2 } from 'lucide-react';

import type { MyInvites } from './constants';
import { Button } from './components';

interface InviteHeroProps {
  enabled: boolean;
  rule: MyInvites['rule'];
  heroTitle: string;
  inviteCode: string;
  qrUrl: string | null;
  posterBusy: boolean;
  onCopyLink: () => void;
  onOpenPoster: () => void;
}

/** 页头：奖励文案、复制链接 / 查看海报入口与邀请二维码。 */
export function InviteHero({
  enabled,
  rule,
  heroTitle,
  inviteCode,
  qrUrl,
  posterBusy,
  onCopyLink,
  onOpenPoster,
}: InviteHeroProps) {
  return (
    <section className="invite-hero">
      <div className="invite-hero-copy">
        <h1>{heroTitle}</h1>
        <p>
          {enabled ? (
            <>
              好友通过链接注册并完成
              {rule.triggerOn === 'first_pay' ? '首次付费' : '注册'}后，奖励自动发放到你的积分账户。
            </>
          ) : (
            '邀请奖励规则尚未配置，当前分享链接仅记录邀请关系，不发放积分。'
          )}
        </p>
        <div className="invite-hero-actions">
          <Button type="primary" icon={<Link2 size={15} />} onClick={onCopyLink}>
            复制邀请链接
          </Button>
          <Button icon={<ImageIcon size={15} />} loading={posterBusy} onClick={onOpenPoster}>
            查看邀请海报
          </Button>
        </div>
      </div>
      {/* 二维码与「邀请码」并置: 电脑上看链接、面对面时直接让对方扫 */}
      <aside className="invite-hero-qr">
        {qrUrl ? (
          <img src={qrUrl} alt={`邀请二维码，邀请码 ${inviteCode}`} />
        ) : (
          <span className="invite-hero-qr-fallback" aria-hidden />
        )}
        <div className="invite-hero-qr-meta">
          <span>邀请码</span>
          <strong>{inviteCode}</strong>
        </div>
        <p>扫码注册，自动绑定邀请关系</p>
      </aside>
    </section>
  );
}
