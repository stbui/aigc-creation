import { Link2 } from 'lucide-react';

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
    <section className="flex flex-col items-stretch gap-6 rounded-xl border border-border bg-[radial-gradient(120%_160%_at_100%_0%,var(--brand-bg)_0%,transparent_58%),linear-gradient(115deg,var(--brand-bg)_0%,var(--card-bg)_64%)] p-6 min-[901px]:flex-row min-[901px]:items-center min-[901px]:justify-between min-[901px]:gap-8 min-[901px]:px-8 min-[901px]:py-[30px]">
      <div className="min-w-0 flex-1">
        <h1 className="m-0 text-[23px] leading-[1.35] font-bold tracking-[-0.3px] text-foreground min-[901px]:text-[28px] min-[901px]:leading-[1.3]">
          {heroTitle}
        </h1>
        <p className="mt-3 mb-0 max-w-[560px] text-sm leading-6 text-muted-foreground">
          {enabled ? (
            <>
              好友通过链接注册并完成
              {rule.triggerOn === 'first_pay' ? '首次付费' : '注册'}后，奖励自动发放到你的积分账户。
            </>
          ) : (
            '邀请奖励规则尚未配置，当前分享链接仅记录邀请关系，不发放积分。'
          )}
        </p>
        <div className="mt-[22px] flex flex-wrap gap-3 [&_[data-slot=button]]:h-9 [&_[data-slot=button]]:rounded-md [&_[data-slot=button]]:px-4">
          <Button variant="default" onClick={onCopyLink}>
            {<Link2 size={15} />}
            复制邀请链接
          </Button>
          <Button disabled={posterBusy} onClick={onOpenPoster}>
            {posterBusy && <span className="state-spinner is-small" aria-hidden />}
            查看邀请海报
          </Button>
        </div>
      </div>
      {/* 二维码与「邀请码」并置: 电脑上看链接、面对面时直接让对方扫 */}
      <aside className="w-full max-w-[320px] flex-none rounded-lg border border-border bg-card p-3 text-center shadow-card min-[901px]:w-[188px] min-[901px]:max-w-none">
        {qrUrl ? (
          <img
            className="block w-full rounded-md bg-muted"
            src={qrUrl}
            alt={`邀请二维码，邀请码 ${inviteCode}`}
          />
        ) : (
          <span className="block aspect-square w-full rounded-md bg-muted" aria-hidden />
        )}
        <div className="mt-2.5 flex items-baseline justify-center gap-1.5 text-xs text-muted-foreground">
          <span>邀请码</span>
          <strong className="text-[15px] tracking-[0.08em] text-foreground tabular-nums">
            {inviteCode}
          </strong>
        </div>
        <p className="mt-1 mb-0 text-xs leading-4 text-muted-foreground">
          扫码注册，自动绑定邀请关系
        </p>
      </aside>
    </section>
  );
}
