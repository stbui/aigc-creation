import { MultiFusionOutputSettings } from './MultiFusionOutputSettings';
import { Spin } from '../../ui';

/**
 * 提交区（sticky 白底容器，参考站 §5.13）。
 *
 * 该元素同时挂 `image-tool-submit-area` 与 `multi-image-fusion-submit-area`：
 * 两者特异度相同，后定义者胜 → 真实底色 #fff / z-index 10（非 #f6f7fb / 5）。
 */
export function MultiFusionSubmitBar({
  submitting,
  disabled,
  blockedReason,
  creditLabel,
  settingsOpen,
  ratio,
  resolution,
  onToggleSettings,
  onRatioChange,
  onResolutionChange,
  onSubmit,
}: {
  submitting: boolean;
  /** 主体图 / 搭配图缺失、能力不可用等导致的提交禁用 */
  disabled: boolean;
  /** 能力不可用原因; null 表示不展示提示 */
  blockedReason: string | null;
  /** 提交按钮上的价格口径; null = 能力清单未到，不显示任何占位 */
  creditLabel: string | null;
  settingsOpen: boolean;
  ratio: string;
  resolution: string;
  onToggleSettings: () => void;
  onRatioChange: (value: string) => void;
  onResolutionChange: (value: string) => void;
  onSubmit: () => void;
}) {
  return (
    <div className="image-tool-submit-area multi-image-fusion-submit-area">
      <MultiFusionOutputSettings
        open={settingsOpen}
        ratio={ratio}
        resolution={resolution}
        onToggle={onToggleSettings}
        onRatioChange={onRatioChange}
        onResolutionChange={onResolutionChange}
      />
      <button
        type="button"
        className="multi-image-fusion-submit-button"
        disabled={disabled}
        onClick={onSubmit}
      >
        {submitting ? (
          <>
            <Spin size="small" />
            <span>生成中…</span>
          </>
        ) : (
          <>
            <span>立即生成</span>
            {/* creditLabel 为 null = 能力清单未到 (加载中)。
                此时不显示任何价格占位 —— "加载中…"放在价格位上会被读成价格文案,
                且用户点下按钮前看不到扣费提示。空着即可, 清单到达后会补上。 */}
            {creditLabel && <small>{creditLabel}</small>}
          </>
        )}
      </button>
      {blockedReason && (
        <p className="tool-submit-notice tool-submit-notice-error">{blockedReason}</p>
      )}
    </div>
  );
}
