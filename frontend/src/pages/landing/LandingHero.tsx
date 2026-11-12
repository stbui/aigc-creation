import { useNavigate } from 'react-router-dom';
import { ArrowRight, Check, Sparkles } from 'lucide-react';

import { HERO_SHOTS } from './constants';

interface LandingHeroProps {
  /** 首屏文案里的能力数：运行时可见能力数 */
  totalCapabilities: number;
  /** 主 CTA 目标：首个可见核心场景，未到达清单时为工作台 */
  primaryTo: string;
}

/** 首屏：左文案 + 双 CTA + 三条保障，右 2x2 真实产出拼贴。 */
export function LandingHero({ totalCapabilities, primaryTo }: LandingHeroProps) {
  const navigate = useNavigate();

  return (
    <section className="lp-hero">
      <div className="lp-hero-inner">
        <div className="lp-hero-copy">
          <span className="lp-eyebrow">
            <Sparkles size={13} aria-hidden />
            货觉AI · {totalCapabilities} 项电商视觉能力
          </span>
          <h1>
            一张商品图
            <br />
            <em>出全套电商视觉</em>
          </h1>
          <p className="lp-hero-sub">
            白底主图、场景图、卖点图、详情长图与修图工具，全部在同一个工作台完成。
            真实模型生成，按能力计费。
          </p>
          <div className="lp-hero-actions">
            <button
              type="button"
              className="lp-btn lp-btn-primary"
              onClick={() => navigate(primaryTo)}
            >
              免费开始创作
              <ArrowRight size={16} aria-hidden />
            </button>
            <button type="button" className="lp-btn lp-btn-ghost" onClick={() => navigate('/packages')}>
              查看套餐价目
            </button>
          </div>
          <ul className="lp-hero-proof">
            <li>
              <Check size={14} aria-hidden />
              真实模型产出
            </li>
            <li>
              <Check size={14} aria-hidden />
              失败原额退还
            </li>
            <li>
              <Check size={14} aria-hidden />
              生成即入库
            </li>
          </ul>
        </div>
        <div className="lp-hero-visual" aria-hidden>
          {HERO_SHOTS.map((shot, index) => (
            <figure key={shot.src} className={`lp-hero-shot is-${index + 1}`}>
              <img
                src={shot.src}
                alt=""
                width={600}
                height={800}
                loading={index < 2 ? 'eager' : 'lazy'}
              />
              <figcaption>{shot.label}</figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}
