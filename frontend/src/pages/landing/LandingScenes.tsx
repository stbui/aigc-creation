import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';

import { A, type BizCard } from './constants';
import { Card, CardContent, TextAction } from './components';
import { LandingHeading, LandingKicker, LandingLede, LandingSection } from './LandingSection';

interface LandingScenesProps {
  cards: BizCard[];
}

/**
 * 核心场景：商品主图 / 商品详情 / 爆款复刻三张入口卡。
 *
 * 卡片壳换 shadcn `Card`（悬停只改边框与投影，不自己写过渡），
 * 底部入口换 `TextAction asChild` 指向工具页 —— 语义是链接，密度与其它
 * 文字入口一致。
 */
export function LandingScenes({ cards }: LandingScenesProps) {
  return (
    <LandingSection>
      <header className="max-w-[640px]">
        <LandingKicker>核心场景</LandingKicker>
        <LandingHeading>从一张商品图，到一整套视觉</LandingHeading>
        <LandingLede>主图、详情、爆款复刻三条主线，覆盖上新与投放的主要构图需求。</LandingLede>
      </header>

      <div className="mt-8 grid grid-cols-3 gap-5 max-[900px]:grid-cols-1">
        {cards.map((card) => (
          <Card
            key={card.title}
            className="group gap-0 overflow-hidden rounded-2xl border-border py-0 transition-[transform,box-shadow,border-color] duration-200 hover:-translate-y-0.75 hover:border-brand hover:shadow-card"
          >
            <div className="aspect-[1712/800] overflow-hidden bg-muted">
              <img
                src={card.img}
                alt=""
                width={1712}
                height={800}
                loading="lazy"
                className="block size-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
              />
            </div>
            <CardContent className="flex flex-1 flex-col gap-1.5 px-[22px] pt-5 pb-4.5">
              <h3 className="m-0 flex items-center gap-2 text-[17px] font-semibold text-foreground">
                <img
                  className="size-[22px] object-contain"
                  src={`${A}/icons/${card.icon}.svg`}
                  alt=""
                  aria-hidden
                  loading="lazy"
                  decoding="async"
                />
                {card.title}
              </h3>
              <p className="m-0 text-[13.5px] leading-[1.7] text-muted-foreground">{card.desc}</p>
              <TextAction asChild className="mt-3 self-start font-semibold">
                <Link to={card.to}>
                  开始生成
                  <ArrowRight size={14} aria-hidden />
                </Link>
              </TextAction>
            </CardContent>
          </Card>
        ))}
      </div>
    </LandingSection>
  );
}
