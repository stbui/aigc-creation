import { CLONE_DEGREES } from './constants';

/** 复刻程度两档（独立卡，默认高度复刻）。 */
export function ViralCloneDegreeCard({
  degree,
  onDegreeChange,
}: {
  degree: 'reference_style' | 'high_replica';
  onDegreeChange: (value: 'reference_style' | 'high_replica') => void;
}) {
  return (
    <section className="pk-config-card vc-degree-card">
      <div className="pk-section">
        <strong className="pk-section-title">复刻程度</strong>
        <div className="pk-section-picker vc-degree-options" role="radiogroup" aria-label="复刻程度">
          {CLONE_DEGREES.map((d) => {
            const active = d.value === degree;
            return (
              <button
                key={d.value}
                type="button"
                role="radio"
                aria-checked={active}
                className={`vc-degree-option${active ? ' vc-degree-option-active' : ''}`}
                onClick={() => onDegreeChange(d.value)}
              >
                <span className="vc-degree-title">
                  <i className="vc-degree-dot" aria-hidden />
                  {d.label}
                </span>
                <small>{d.desc}</small>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
