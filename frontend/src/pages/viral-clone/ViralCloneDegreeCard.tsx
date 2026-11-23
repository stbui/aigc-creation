import { CLONE_DEGREES, type CloneDegree } from './constants';
import { SectionCard, ToggleGroup, ToggleGroupItem } from './components';

/**
 * 复刻程度两档（独立配置卡，默认高度复刻）。
 *
 * 卡片外壳与标题行走 `SectionCard`；选项皮肤收在 `./style.css` 的
 * `.vc-degree-*`，不再把一长串 tailwind 原子类写到 JSX 里 —— 与相邻页面
 * 的分组标题、圆角、16px 列间距才对得上。
 */
export function ViralCloneDegreeCard({
  degree,
  onDegreeChange,
}: {
  degree: CloneDegree;
  onDegreeChange: (value: CloneDegree) => void;
}) {
  return (
    <SectionCard title="复刻程度">
      <ToggleGroup
        type="single"
        value={degree}
        onValueChange={(value) => {
          if (value) onDegreeChange(value as CloneDegree);
        }}
        aria-label="复刻程度"
        className="vc-degree-options"
      >
        {CLONE_DEGREES.map((d) => (
          <ToggleGroupItem key={d.value} value={d.value} className="vc-degree-option">
            <span className="vc-degree-title">
              <span className="vc-degree-dot" aria-hidden />
              {d.label}
            </span>
            <span className="vc-degree-desc">{d.desc}</span>
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </SectionCard>
  );
}
