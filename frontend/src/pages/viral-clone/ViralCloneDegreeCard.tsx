import { CLONE_DEGREES } from './constants';
import { FieldLegend, FieldSet, ToggleGroup } from './components';

/** 复刻程度两档（独立卡，默认高度复刻）。 */
export function ViralCloneDegreeCard({
  degree,
  onDegreeChange,
}: {
  degree: 'reference_style' | 'high_replica';
  onDegreeChange: (value: 'reference_style' | 'high_replica') => void;
}) {
  return (
    <FieldSet className="vc-degree-section">
      <FieldLegend variant="label" className="mb-0 text-sm font-semibold">
        复刻程度
      </FieldLegend>
      <ToggleGroup
        value={degree}
        onValueChange={(value) => {
          if (value) onDegreeChange(value as 'reference_style' | 'high_replica');
        }}
        aria-label="复刻程度"
        className="vc-degree-options grid w-full grid-cols-2 gap-3"
        itemClassName="vc-degree-toggle group h-auto min-h-20 w-full flex-col items-start justify-center gap-2 whitespace-normal rounded-lg border-border bg-secondary px-4 py-2.5 text-left font-normal hover:bg-muted data-[state=on]:border-primary data-[state=on]:bg-accent"
        options={CLONE_DEGREES.map((d) => ({
          value: d.value,
          label: (
            <>
              <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                <span
                  className="size-3.5 shrink-0 rounded-full border border-border bg-transparent group-data-[state=on]:border-4 group-data-[state=on]:border-primary group-data-[state=on]:bg-background"
                  aria-hidden
                />
                {d.label}
              </span>
              <span className="text-xs leading-5 text-muted-foreground">{d.desc}</span>
            </>
          ),
        }))}
      />
    </FieldSet>
  );
}
