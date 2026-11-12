import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';

import { A, type ToolEntry } from './constants';

interface LandingToolsProps {
  entries: ToolEntry[];
}

/** 修图工具：一屏内完成工具选择。 */
export function LandingTools({ entries }: LandingToolsProps) {
  const navigate = useNavigate();

  return (
    <section className="lp-section lp-section-tight">
      <div className="lp-tools-head">
        <div>
          <span className="lp-kicker">修图工具</span>
          <h2>日常修图，一个入口</h2>
        </div>
        <Link to="/workbench" className="lp-text-link">
          全部工具
          <ArrowRight size={14} aria-hidden />
        </Link>
      </div>
      <div className="lp-tool-grid">
        {entries.map((entry) => (
          <button
            key={entry.label}
            type="button"
            className="lp-tool"
            onClick={() => navigate(entry.to)}
          >
            <img
              src={`${A}/icons/${entry.icon}.svg`}
              alt=""
              aria-hidden
              loading="lazy"
              decoding="async"
            />
            <span>{entry.label}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
