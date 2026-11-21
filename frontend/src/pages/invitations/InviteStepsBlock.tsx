import { ListOrdered } from 'lucide-react';

import type { InviteStep } from './utils';

interface InviteStepsBlockProps {
  steps: InviteStep[];
}

/** 邀请步骤：文案由 `buildInviteSteps` 按真实奖励规则生成。 */
export function InviteStepsBlock({ steps }: InviteStepsBlockProps) {
  return (
    <section className="rounded-xl border border-border bg-card px-6 pt-[22px] pb-6 max-[640px]:px-4 max-[640px]:pt-[18px] max-[640px]:pb-5">
      <div className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="m-0 flex items-center gap-2 text-base font-semibold text-foreground">
          <ListOrdered size={16} aria-hidden /> 邀请步骤
        </h2>
        <span className="text-xs leading-[18px] text-muted-foreground">好友完成指定动作后自动发放</span>
      </div>
      <ol className="m-0 grid list-none grid-cols-1 gap-4 p-0 min-[901px]:grid-cols-3">
        {steps.map((step, index) => (
          <li key={step.title} className="flex flex-col gap-1.5 rounded-lg bg-page p-4">
            <span className="grid size-6 place-items-center rounded-full bg-brand text-xs text-primary-foreground">
              {index + 1}
            </span>
            <span className="text-sm font-semibold text-foreground">{step.title}</span>
            <span className="text-xs leading-5 text-muted-foreground">{step.desc}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
