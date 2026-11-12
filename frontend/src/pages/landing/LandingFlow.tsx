import { FLOW_STEPS } from './constants';

/** 使用流程：上传 → 选能力 → 下载，三步说明。 */
export function LandingFlow() {
  return (
    <section className="lp-section lp-section-tight">
      <div className="lp-flow-panel">
        {FLOW_STEPS.map((step, index) => {
          const Icon = step.icon;
          return (
            <article key={step.title} className="lp-step">
              <span className="lp-step-index">0{index + 1}</span>
              <div className="lp-step-copy">
                <h3>
                  <Icon size={16} aria-hidden />
                  {step.title}
                </h3>
                <p>{step.desc}</p>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
