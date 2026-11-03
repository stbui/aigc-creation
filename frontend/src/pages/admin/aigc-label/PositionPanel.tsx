import { FormField, NumberField, Panel, RangeField } from '~/admin-ui/primitives';
import { POSITION_LABELS, POSITION_OPTIONS } from './constants';
import { ChoiceButton } from './ChoiceButton';
import type { AigcLabelSpec } from '../../../types/api';

/**
 * 位置与缩放。
 *
 * 宽度按比例计算并受上下限夹紧：缩略图不至于被角标糊掉，大图上也不会
 * 小到看不见。
 */
export function PositionPanel({
  spec,
  editable,
  onPatch,
}: {
  spec: AigcLabelSpec;
  editable: boolean;
  onPatch: (next: Partial<AigcLabelSpec>) => void;
}) {
  return (
    <Panel title="位置与缩放">
      <div className="flex flex-col gap-4">
        <FormField label="位置">
          <div className="flex flex-wrap gap-2">
            {POSITION_OPTIONS.map((p) => (
              <ChoiceButton
                key={p}
                pressed={spec.position === p}
                disabled={!editable}
                onClick={() => onPatch({ position: p })}
              >
                {POSITION_LABELS[p]}
              </ChoiceButton>
            ))}
          </div>
        </FormField>

        <FormField label="宽度（占图片宽度的比例）">
          <RangeField
            value={spec.scalePercent}
            min={4}
            max={60}
            suffix="%"
            onChange={(v) => onPatch({ scalePercent: v })}
            disabled={!editable}
            ariaLabel="宽度比例"
          />
        </FormField>

        <FormField label="宽度上下限" hint="缩略图不至于被角标糊掉，大图上也不会小到看不见">
          <div className="flex items-center gap-2">
            <NumberField
              value={spec.minWidthPx}
              min={16}
              max={2048}
              onChange={(next) => onPatch({ minWidthPx: next ?? spec.minWidthPx })}
              disabled={!editable}
              ariaLabel="最小宽度"
              className="w-24"
            />
            <span className="text-xs text-muted-foreground">~</span>
            <NumberField
              value={spec.maxWidthPx}
              min={16}
              max={4096}
              onChange={(next) => onPatch({ maxWidthPx: next ?? spec.maxWidthPx })}
              disabled={!editable}
              ariaLabel="最大宽度"
              className="w-24"
            />
            <span className="text-xs text-muted-foreground">px</span>
          </div>
        </FormField>

        <FormField label="边距（占图片宽度的比例，至少 6px）">
          <RangeField
            value={spec.marginPercent}
            min={0}
            max={10}
            step={0.5}
            suffix="%"
            onChange={(v) => onPatch({ marginPercent: v })}
            disabled={!editable}
            ariaLabel="边距"
          />
        </FormField>

        <FormField label="整体不透明度" hint="低于 20% 在浅色图上几乎不可见，服务端会按下限夹紧">
          <RangeField
            value={spec.opacity}
            min={20}
            max={100}
            suffix="%"
            onChange={(v) => onPatch({ opacity: v })}
            disabled={!editable}
            ariaLabel="整体不透明度"
          />
        </FormField>
      </div>
    </Panel>
  );
}
