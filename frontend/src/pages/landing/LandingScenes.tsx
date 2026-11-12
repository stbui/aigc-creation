import { useNavigate } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';

import { A, type BizCard } from './constants';

interface LandingScenesProps {
  cards: BizCard[];
}

/** 核心场景：商品主图 / 商品详情 / 爆款复刻三张入口卡。 */
export function LandingScenes({ cards }: LandingScenesProps) {
  const navigate = useNavigate();

  return (
    <section className="lp-section">
      <header className="lp-section-head">
        <span className="lp-kicker">核心场景</span>
        <h2>从一张商品图，到一整套视觉</h2>
        <p>主图、详情、爆款复刻三条主线，覆盖上新与投放的主要构图需求。</p>
      </header>
      <div className="lp-scene-grid">
        {cards.map((card) => (
          <article key={card.title} className="lp-scene-card">
            <div className="lp-scene-media">
              <img src={card.img} alt="" width={1712} height={800} loading="lazy" />
            </div>
            <div className="lp-scene-body">
              <h3>
                <img
                  className="lp-scene-icon"
                  src={`${A}/icons/${card.icon}.svg`}
                  alt=""
                  aria-hidden
                  loading="lazy"
                  decoding="async"
                />
                {card.title}
              </h3>
              <p>{card.desc}</p>
              <button type="button" className="lp-scene-link" onClick={() => navigate(card.to)}>
                开始生成
                <ArrowRight size={14} aria-hidden />
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
