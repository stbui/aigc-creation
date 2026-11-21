import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';

import { Button } from './components';

interface LandingCtaProps {
  primaryTo: string;
}

/**
 * 底部行动区：品牌渐变通栏 + 主 CTA。
 *
 * CTA 是 `Button asChild variant="secondary"`（白底）—— 在品牌紫背景上，
 * 它和首屏那一枚同一角色，只是换了底色。
 */
export function LandingCta({ primaryTo }: LandingCtaProps) {
  return (
    <section className="mx-auto mt-24 max-w-[1200px] px-6 max-[900px]:px-5">
      <div className="rounded-2xl bg-[linear-gradient(120deg,var(--brand)_0%,var(--brand-light)_100%)] px-8 py-14 text-center text-card max-[640px]:px-6 max-[640px]:py-10">
        <h2 className="m-0 text-[32px] font-bold tracking-[-0.6px] max-[640px]:text-[25px]">
          现在开始，用一张图做完一套图
        </h2>
        <p className="mt-3 text-[14.5px] opacity-[0.86]">
          注册即用，按能力计费，生成失败原额退还。
        </p>
        <Button
          asChild
          variant="secondary"
          size="lg"
          className="mt-6.5 h-11.5 gap-1.5 px-5.5 text-[14.5px] font-semibold text-brand hover:-translate-y-px hover:bg-secondary"
        >
          <Link to={primaryTo}>
            免费开始创作
            <ArrowRight size={16} aria-hidden />
          </Link>
        </Button>
      </div>
    </section>
  );
}