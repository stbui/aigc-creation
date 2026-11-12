import { CAPABILITY_ID } from './constants';
import { ModelPicker, ToolSettingsPopover, ToolSubmitBar } from './components';
import { ShoppableCarouselStepper } from './ShoppableCarouselStepper';

interface ShoppableCarouselFooterProps {
  count: number;
  min: number;
  max: number;
  onCountChange: (value: number) => void;
  settingsOpen: boolean;
  onToggleSettings: () => void;
  ratio: string;
  onRatioChange: (value: string) => void;
  resolution: string;
  onResolutionChange: (value: string) => void;
  onModelQuoteChange: (credits: number | null) => void;
  generating: boolean;
  /** 表单不满足 / 能力不可用时禁用提交 */
  submitDisabled: boolean;
  /** 通道可用时才挂登录墙；不可用时保持真实文案 */
  guestLabel: string | undefined;
  creditLabel: string | null;
  hint: string | undefined;
  onSubmit: () => void;
}

/**
 * 左栏固定底栏：张数与高级设置并排，下方是生成按钮。
 *
 * 参考站底栏只有一行「张数 + 生成按钮」（415×125）；多一行会把底栏撑高，
 * 故高级设置与张数放在同一行。
 */
export function ShoppableCarouselFooter({
  count,
  min,
  max,
  onCountChange,
  settingsOpen,
  onToggleSettings,
  ratio,
  onRatioChange,
  resolution,
  onResolutionChange,
  onModelQuoteChange,
  generating,
  submitDisabled,
  guestLabel,
  creditLabel,
  hint,
  onSubmit,
}: ShoppableCarouselFooterProps) {
  return (
    <div className="sc-form-footer">
      <div className="sc-footer-row">
        <ShoppableCarouselStepper
          count={count}
          min={min}
          max={max}
          onCountChange={onCountChange}
        />
        <ToolSettingsPopover
          open={settingsOpen}
          onToggle={onToggleSettings}
          ratio={ratio}
          onRatioChange={onRatioChange}
          resolution={resolution}
          onResolutionChange={onResolutionChange}
          capabilityId={CAPABILITY_ID}
          showRatio={false}
          modelPicker={
            <ModelPicker
              capability={CAPABILITY_ID}
              options={{ ratio, resolution }}
              onQuoteChange={onModelQuoteChange}
            />
          }
        />
      </div>
      <ToolSubmitBar
        submitting={generating}
        disabled={submitDisabled}
        label="生成带货图文"
        guestLabel={guestLabel}
        creditLabel={creditLabel ?? undefined}
        hint={hint}
        onSubmit={onSubmit}
      />
    </div>
  );
}
