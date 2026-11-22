import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';

import { A, type ToolEntry } from './constants';
import { Button, TextAction } from './components';
import { LandingHeading, LandingKicker, LandingSection } from './LandingSection';

interface LandingToolsProps {
  entries: ToolEntry[];
}

/**
 * 修图工具：一屏内完成工具选择。
 *
 * 每个入口是一枚 `Button asChild`（60px 高、13.5px 文案、悬停改品牌色），
 * 语义仍是链接；右上「全部工具」是 `TextAction`。
 */
export function LandingTools({ entries }: LandingToolsProps) {
  return (
    <LandingSection tight>
      <div className="flex flex-wrap items-end justify-between gap-6 max-[900px]:flex-col max-[900px]:items-start max-[900px]:gap-4">
        <div>
          <LandingKicker>修图工具</LandingKicker>
          <LandingHeading>日常修图，一个入口</LandingHeading>
        </div>
        <TextAction asChild className="font-semibold whitespace-nowrap">
          <Link to="/workbench">
            全部工具
            <ArrowRight size={14} aria-hidden />
          </Link>
        </TextAction>
      </div>

      <div className="mt-6 grid grid-cols-4 gap-3 max-[900px]:grid-cols-2 max-[640px]:grid-cols-1">
        {entries.map((entry) => (
          <Button
            key={entry.label}
            asChild
            variant="outline"
            className="h-15 justify-start gap-3 rounded-lg px-4.5 text-sm font-medium text-foreground hover:-translate-y-px hover:border-brand hover:text-brand hover:shadow-card"
          >
            <Link to={entry.to}>
              <img
                src={`${A}/icons/${entry.icon}.svg`}
                alt=""
                aria-hidden
                loading="lazy"
                decoding="async"
                className="size-[22px] shrink-0 object-contain"
              />
              {entry.label}
            </Link>
          </Button>
        ))}
      </div>
    </LandingSection>
  );
}
