import { CLONE_DEGREES, type CloneDegree } from './constants';
import { ToggleGroup } from './components';

/**
 * 复刻程度两档（独立配置卡，默认高度复刻）。
 *
 * 与商品详情「包含模块」同一套结构：`pk-config-card` > `pk-section` >
 * `pk-section-title` + 两列选项。选项皮肤收在 `./style.css` 的 `.vc-degree-*`，
 * 不再把一长串 tailwind 原子类写到 JSX 里 —— 与相邻页面的分组标题、圆角、
 * 16px 列间距才对得上。
 */
export function ViralCloneDegreeCard({
  degree,
  onDegreeChange,
}: {
  degree: CloneDegree;
  onDegreeChange: (value: CloneDegree) => void;
}) {
  return (
    <section className="pk-config-card">
      <div className="pk-section">
        <strong className="pk-section-title u-font-14">复刻程度</strong>
        <ToggleGroup
          value={degree}
          onValueChange={(value) => {
            if (value) onDegreeChange(value as CloneDegree);
          }}
          aria-label="复刻程度"
          className="vc-degree-options"
          itemClassName="vc-degree-option"
          options={CLONE_DEGREES.map((d) => ({
            value: d.value,
            label: (
              <>
                <span className="vc-degree-title">
                  <span className="vc-degree-dot" aria-hidden />
                  {d.label}
                </span>
                <span className="vc-degree-desc">{d.desc}</span>
              </>
            ),
          }))}
        />
      </div>
    </section>
  );
}
