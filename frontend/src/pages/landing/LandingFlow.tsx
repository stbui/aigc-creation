import { FLOW_STEPS } from './constants';
import { LandingSection } from './LandingSection';

/**
 * 使用流程：上传 → 选能力 → 下载，三步说明。
 *
 * 这是说明性版面（编号 + 标题 + 一句描述），没有交互语义，因此不用控件拼；
 * 只把浅紫渐变面板与三步栅格留在 Tailwind 类里。
 */
export function LandingFlow() {
  return (
    <LandingSection tight>
      <div className="grid grid-cols-3 gap-7 rounded-2xl border border-border bg-[linear-gradient(120deg,var(--brand-bg)_0%,var(--card-bg)_72%)] px-10 py-9 max-[900px]:grid-cols-1 max-[900px]:gap-5.5 max-[900px]:p-7">
        {FLOW_STEPS.map((step, index) => {
          const Icon = step.icon;
          return (
            <article key={step.title} className="flex gap-3.5">
              <span className="grid size-9.5 shrink-0 place-items-center rounded-lg border border-border bg-card text-[13px] font-bold text-brand">
                0{index + 1}
              </span>
              <div>
                <h3 className="mt-0.5 flex items-center gap-1.5 text-[15.5px] font-semibold text-foreground">
                  <Icon size={16} aria-hidden className="text-brand" />
                  {step.title}
                </h3>
                <p className="mt-1.5 text-[13.5px] leading-[1.7] text-muted-foreground">
                  {step.desc}
                </p>
              </div>
            </article>
          );
        })}
      </div>
    </LandingSection>
  );
}
