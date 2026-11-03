import { ChevronDown, X } from 'lucide-react';

import { ratioOptions, resolutionOptions } from './utils';
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
  const resolutionLabel = resolution.toUpperCase();
  return (
    <div className="image-tool-submit-area multi-image-fusion-submit-area">
      <div className="image-output-settings-shell">
        <button
          type="button"
          className="image-output-settings-summary"
          aria-expanded={settingsOpen}
          onClick={onToggleSettings}
        >
          <span className="image-output-settings-summary-label">高级设置</span>
          <span className="image-output-settings-chip">比例 {ratio}</span>
          <span className="image-output-settings-chip">画质 {resolutionLabel}</span>
          <ChevronDown size={14} className={settingsOpen ? 'is-open' : undefined} />
        </button>
        {settingsOpen && (
          <div className="image-output-settings-popover">
            <div className="image-output-settings-popover-head">
              <h2>高级设置</h2>
              <button
                type="button"
                className="image-output-settings-close"
                aria-label="关闭高级设置"
                title="关闭"
                onClick={onToggleSettings}
              >
                <X size={18} />
              </button>
            </div>
            <div className="image-output-settings">
              <div className="image-output-settings-group">
                <span className="image-output-settings-label">图片比例</span>
                <div className="image-output-ratio-grid" aria-label="图片比例选项">
                  {ratioOptions('multi_fusion').map((o) => {
                    const r = String(o.value);
                    return (
                      <button
                        key={r}
                        type="button"
                        className={`image-output-ratio-option${r === ratio ? ' active' : ''}`}
                        aria-pressed={r === ratio}
                        onClick={() => onRatioChange(r)}
                      >
                        <small>{r}</small>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="image-output-settings-group">
                <span className="image-output-settings-label">分辨率（积分/权益消耗）</span>
                <div className="image-output-resolution-grid" aria-label="分辨率选项">
                  {resolutionOptions('multi_fusion').map((o) => (
                    <button
                      key={o.value}
                      type="button"
                      className={`image-output-resolution-option${
                        o.value === resolution ? ' active' : ''
                      }`}
                      aria-pressed={o.value === resolution}
                      disabled={o.disabled}
                      title={o.disabled ? o.disabledReason : undefined}
                      onClick={() => onResolutionChange(String(o.value))}
                    >
                      <strong>{o.shortLabel ?? o.label}</strong>
                      <span>{o.sub}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
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
