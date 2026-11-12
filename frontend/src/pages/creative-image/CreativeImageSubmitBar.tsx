import { X } from 'lucide-react';

import type { CreationCapability } from './constants';
import { ModelPicker, ToolSettingsPopover, ToolSubmitBar } from './components';

interface CreativeImageSubmitBarProps {
  generating: boolean;
  /** 表单不满足 / 已登录且能力不可用，二者都由页面判定后下发 */
  disabled: boolean;
  creditLabel: string | null;
  /** 能力不可用原因；null 表示不展示提示 */
  unavailableReason: string | null;
  settingsOpen: boolean;
  onToggleSettings: () => void;
  ratio: string;
  onRatioChange: (value: string) => void;
  resolution: string;
  onResolutionChange: (value: string) => void;
  capability: CreationCapability;
  onModelQuoteChange: (credits: number | null) => void;
  onSubmit: () => void;
}

/** 左栏底部提交区：不可用提示 + 高级设置浮层 + 主按钮（sticky 底部）。 */
export function CreativeImageSubmitBar({
  generating,
  disabled,
  creditLabel,
  unavailableReason,
  settingsOpen,
  onToggleSettings,
  ratio,
  onRatioChange,
  resolution,
  onResolutionChange,
  capability,
  onModelQuoteChange,
  onSubmit,
}: CreativeImageSubmitBarProps) {
  return (
    <div className="fc-actions">
      {/* 无可用模型通道: 提前说明, 而不是让用户点下去等一次 42204 */}
      {unavailableReason && !generating && (
        <p className="tool-submit-notice tool-submit-notice-error">{unavailableReason}</p>
      )}
      <ToolSubmitBar
        submitting={generating}
        /*
         * 不可用的置灰**只对已登录生效**: guest 点按钮的职责是弹登录框,
         * 置灰会把它挡掉（disabled 由页面按登录态计算）。
         */
        disabled={disabled}
        label="立即生成"
        guestLabel="登录免费生成"
        creditLabel={creditLabel ?? undefined}
        settings={
          <ToolSettingsPopover
            open={settingsOpen}
            onToggle={onToggleSettings}
            ratio={ratio}
            onRatioChange={onRatioChange}
            resolution={resolution}
            onResolutionChange={onResolutionChange}
            capabilityId={capability}
            modelPicker={
              <ModelPicker
                capability={capability}
                options={{ ratio, resolution }}
                onQuoteChange={onModelQuoteChange}
              />
            }
            popoverClassName="fc-settings-popover"
            popoverRole="dialog"
            popoverAriaLabel="高级设置"
            header={
              <div className="fc-settings-popover-head">
                <h2>高级设置</h2>
                <button
                  type="button"
                  className="fc-settings-close"
                  aria-label="关闭高级设置"
                  title="关闭"
                  onClick={() => onToggleSettings()}
                >
                  <X size={18} />
                </button>
              </div>
            }
          />
        }
        onSubmit={onSubmit}
      />
    </div>
  );
}
