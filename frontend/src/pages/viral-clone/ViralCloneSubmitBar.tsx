import { CircleAlert } from 'lucide-react';

import {
  InlineAlert,
  InlineAlertDescription,
  ModelPicker,
  ToolSettingsPopover,
  ToolSubmitBar,
} from './components';

/**
 * 高级设置 + 提交（sticky 底部）。
 *
 * 无可用模型通道时提前说明，而不是让用户点下去等一次 42204。
 */
export function ViralCloneSubmitBar({
  generating,
  formValid,
  unavailableReason,
  creditLabel,
  settingsOpen,
  ratio,
  resolution,
  onToggleSettings,
  onRatioChange,
  onResolutionChange,
  onModelQuoteChange,
  onSubmit,
}: {
  generating: boolean;
  formValid: boolean;
  unavailableReason: string | null;
  creditLabel: string | null;
  settingsOpen: boolean;
  ratio: string;
  resolution: string;
  onToggleSettings: () => void;
  onRatioChange: (value: string) => void;
  onResolutionChange: (value: string) => void;
  onModelQuoteChange: (credits: number | null) => void;
  onSubmit: () => void;
}) {
  return (
    <>
      {unavailableReason && !generating && (
        <InlineAlert variant="destructive" className="vc-submit-alert">
          <CircleAlert />
          <InlineAlertDescription>{unavailableReason}</InlineAlertDescription>
        </InlineAlert>
      )}
      <ToolSubmitBar
        submitting={generating}
        disabled={!formValid || Boolean(unavailableReason)}
        label="立即生成"
        creditLabel={creditLabel ?? undefined}
        settings={
          <ToolSettingsPopover
            open={settingsOpen}
            onToggle={onToggleSettings}
            ratio={ratio}
            onRatioChange={onRatioChange}
            resolution={resolution}
            onResolutionChange={onResolutionChange}
            capabilityId="hot_remake"
            modelPicker={
              <ModelPicker
                capability="hot_remake"
                options={{ ratio, resolution }}
                onQuoteChange={onModelQuoteChange}
              />
            }
          />
        }
        onSubmit={onSubmit}
      />
    </>
  );
}
