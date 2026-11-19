import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';

interface LandingCtaProps {
  primaryTo: string;
}

/** 底部行动区。 */
export function LandingCta({ primaryTo }: LandingCtaProps) {
  return (
    <section className="lp-cta">
      <div className="lp-cta-inner">
        <h2>现在开始，用一张图做完一套图</h2>
        <p>注册即用，按能力计费，生成失败原额退还。</p>
        <Link className="lp-btn lp-btn-on-brand" to={primaryTo}>
          免费开始创作
          <ArrowRight size={16} aria-hidden />
        </Link>
      </div>
    </section>
  );
}
