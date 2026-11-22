import { Link } from 'react-router-dom';
import { ArrowRight, Check, Sparkles } from 'lucide-react';

import { HERO_SHOTS } from './constants';
import { Badge, Button } from './components';

interface LandingHeroProps {
  /** 首屏文案里的能力数：运行时可见能力数 */
  totalCapabilities: number;
  /** 主 CTA 目标：首个可见核心场景，未到达清单时为工作台 */
  primaryTo: string;
}

/**
 * 首屏：左文案 + 双 CTA + 三条保障，右 2x2 真实产出拼贴。
 *
 * 2026-11-21 组件层重构：徽标换 `Badge`、两个 CTA 换 `Button asChild`（语义是
 * 链接，外观是按钮）。拼贴的 4:5 裁切与错落旋转是版面编排，不是控件外观。
 */
export function LandingHero({ totalCapabilities, primaryTo }: LandingHeroProps) {
  return (
    <section className="relative overflow-hidden bg-page" style={HERO_BACKGROUND}>
      <div className="mx-auto grid max-w-[1200px] grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] items-center gap-14 px-6 pt-14 pb-12 max-[1080px]:gap-9 max-[900px]:grid-cols-1 max-[900px]:gap-9 max-[900px]:px-5 max-[900px]:pt-12 max-[900px]:pb-10">
        <div className="min-w-0">
          <Badge
            variant="outline"
            className="h-auto gap-1.5 rounded-full border-border bg-card px-3 py-1.5 text-[12.5px] font-semibold text-brand"
          >
            <Sparkles size={13} aria-hidden />
            货觉AI · {totalCapabilities} 项电商视觉能力
          </Badge>
          <h1 className="mt-5 text-[50px] leading-[1.18] font-bold tracking-[-1.5px] text-foreground max-[1080px]:text-[42px] max-[900px]:text-[38px] max-[640px]:text-[32px] max-[640px]:tracking-[-0.8px]">
            一张商品图
            <br />
            <em className="bg-[linear-gradient(96deg,var(--brand)_10%,var(--brand-light)_90%)] bg-clip-text text-transparent [font-style:normal]">
              出全套电商视觉
            </em>
          </h1>
          <p className="mt-4.5 max-w-[520px] text-[15.5px] leading-[1.8] text-muted-foreground">
            白底主图、场景图、卖点图、详情长图与修图工具，全部在同一个工作台完成。
            真实模型生成，按能力计费。
          </p>
          <div className="mt-7.5 flex flex-wrap gap-3">
            <Button
              asChild
              size="lg"
              className="h-11.5 gap-1.5 px-5.5 text-[14.5px] font-semibold shadow-md"
            >
              <Link to={primaryTo}>
                免费开始创作
                <ArrowRight size={16} aria-hidden />
              </Link>
            </Button>
            <Button
              asChild
              variant="outline"
              size="lg"
              className="h-11.5 px-5.5 text-[14.5px] font-semibold hover:border-brand hover:text-brand"
            >
              <Link to="/packages">查看套餐价目</Link>
            </Button>
          </div>
          <ul className="mt-6.5 flex list-none flex-wrap gap-x-5.5 gap-y-2 p-0 text-[13px] text-muted-foreground">
            {['真实模型产出', '失败原额退还', '生成即入库'].map((proof) => (
              <li key={proof} className="inline-flex items-center gap-1.5">
                <Check size={14} aria-hidden className="shrink-0 text-brand" />
                {proof}
              </li>
            ))}
          </ul>
        </div>

        <div
          className="grid grid-cols-[repeat(2,minmax(0,1fr))] gap-4 py-6 max-[900px]:mx-auto max-[900px]:mt-2 max-[900px]:max-w-[520px]"
          aria-hidden
        >
          {HERO_SHOTS.map((shot, index) => (
            <figure
              key={shot.src}
              className={`relative m-0 overflow-hidden rounded-xl bg-muted shadow-card ${HERO_TILT[index] ?? ''}`}
            >
              <img
                // 案例原图 3:4；拼贴用 4:5 只裁掉少量上下留白，换来首屏能完整露出
                className="block aspect-[4/5] size-full object-cover"
                src={shot.src}
                alt=""
                width={600}
                height={800}
                loading={index < 2 ? 'eager' : 'lazy'}
              />
              <figcaption className="absolute bottom-2.5 left-2.5 rounded-full bg-foreground/65 px-2.5 py-1 text-xs font-medium text-card backdrop-blur-[6px]">
                {shot.label}
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}

/** 首屏两处径向光晕：纯装饰背景，没有交互语义，故按令牌写成内联背景图 */
const HERO_BACKGROUND = {
  backgroundImage:
    'radial-gradient(760px 420px at 8% -8%, var(--brand-bg) 0%, transparent 68%), radial-gradient(680px 380px at 96% 4%, var(--hero-grad-3) 0%, transparent 64%)',
};

/** 四张拼贴的错落旋转；≤640px 复位，窄屏旋转会互相压住 */
const HERO_TILT = [
  'translate-y-4.5 -rotate-[1.2deg] max-[640px]:translate-y-0 max-[640px]:rotate-0',
  '-translate-y-2.5 rotate-1 max-[640px]:translate-y-0 max-[640px]:rotate-0',
  'translate-y-1.5 rotate-1 max-[640px]:translate-y-0 max-[640px]:rotate-0',
  '-translate-y-5.5 -rotate-1 max-[640px]:translate-y-0 max-[640px]:rotate-0',
];
