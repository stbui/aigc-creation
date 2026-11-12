import { ListOrdered } from 'lucide-react';

import type { InviteStep } from './utils';

interface InviteStepsBlockProps {
  steps: InviteStep[];
}

/** 邀请步骤：文案由 `buildInviteSteps` 按真实奖励规则生成。 */
export function InviteStepsBlock({ steps }: InviteStepsBlockProps) {
  return (
    <section className="invite-block">
      <div className="invite-block-head">
        <h2>
          <ListOrdered size={16} aria-hidden /> 邀请步骤
        </h2>
        <span className="invite-block-sub">好友完成指定动作后自动发放</span>
      </div>
      <ol className="invite-steps">
        {steps.map((step, index) => (
          <li key={step.title} className="invite-step">
            <span className="invite-step-no">{index + 1}</span>
            <span className="invite-step-title">{step.title}</span>
            <span className="invite-step-desc">{step.desc}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
