import { Link } from 'react-router-dom';
import { Sparkles } from 'lucide-react';

import { Button } from './components';

/** 没有任何作品时的引导面板。 */
export function StatsEmptyPanel() {
  return (
    <article className="flex min-h-[132px] min-w-0 flex-row items-center gap-[18px] rounded-xl border border-border bg-card px-[26px] py-6 bg-[radial-gradient(circle_at_0_0,var(--brand-bg)_0,transparent_42%)]">
      <span
        className="inline-flex size-11 shrink-0 items-center justify-center rounded-[14px] bg-brand-bg text-brand"
        aria-hidden
      >
        <Sparkles size={20} />
      </span>
      <div className="min-w-0 flex-1">
        <h3 className="m-0 mb-1 text-base font-semibold text-foreground">
          从第一次创作开始积累作品
        </h3>
        <p className="m-0 text-[13px] leading-5 text-[color:var(--text-desc)]">
          去工作台选择一个能力，提交创作后这里会展示你的作品趋势和常用能力。
        </p>
      </div>
      <Button asChild variant="default">
        <Link to="/workbench">开始创作</Link>
      </Button>
    </article>
  );
}
