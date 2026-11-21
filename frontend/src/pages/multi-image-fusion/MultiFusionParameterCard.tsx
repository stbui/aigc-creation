import { VARIANT_COUNTS } from './constants';
import {
  FieldLegend,
  FieldSet,
  Surface,
  SurfaceContent,
  SurfaceHeader,
  SurfaceTitle,
  ToggleGroup,
  ToggleGroupItem,
} from './components';

/**
 * 输出参数卡 —— 当前只有「变体张数」一项。
 *
 * 张数直接进任务参数 `variantCount`；价格随张数变化，故按选项表渲染，
 * 选中态由页面持有的值决定。
 *
 * 2026-11-21 手写 `role="radiogroup"` + `selected` 类改为 shadcn
 * `FieldSet` + `FieldLegend` + `ToggleGroup`（`type="single"` 输出 radiogroup /
 * radio / aria-checked，方向键组内移动，分组由 fieldset 承载）。
 */
export function MultiFusionParameterCard({
  variantCount,
  onVariantCountChange,
}: {
  variantCount: string;
  onVariantCountChange: (value: string) => void;
}) {
  return (
    <Surface className="gap-0 rounded-xl border-border/70 bg-card px-4.5 py-4 shadow-card">
      <SurfaceHeader className="mb-3 px-0">
        <SurfaceTitle className="text-sm leading-5.5 font-bold text-foreground">
          输出参数
        </SurfaceTitle>
      </SurfaceHeader>

      <SurfaceContent className="px-0">
        <FieldSet className="gap-2">
          <FieldLegend variant="label" className="mb-0 text-xs font-bold text-foreground">
            变体张数
          </FieldLegend>
          <ToggleGroup
            type="single"
            value={variantCount}
            onValueChange={(next) => next && onVariantCountChange(next)}
            aria-label="变体张数"
            variant="outline"
            size="sm"
            spacing={1.75}
            className="grid w-full grid-cols-4"
          >
            {VARIANT_COUNTS.map((value) => (
              <ToggleGroupItem
                key={value}
                value={value}
                className="h-8.5 min-w-0 rounded-md border-border bg-card text-xs font-medium text-muted-foreground data-[state=on]:border-transparent data-[state=on]:bg-brand-bg data-[state=on]:text-brand"
              >
                {value} 张
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </FieldSet>
      </SurfaceContent>
    </Surface>
  );
}
