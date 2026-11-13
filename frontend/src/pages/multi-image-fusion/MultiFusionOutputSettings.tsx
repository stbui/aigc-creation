import '../../styles/image-output-settings.css';
import { ChevronDown, X } from 'lucide-react';

import { ratioOptions, resolutionOptions } from './utils';

/**
 * 提交区的高级设置浮层（比例 + 画质）。
 *
 * 与共享 `ToolSettingsPopover` 的区别是**皮肤**：本页是参考站逐像素复刻，
 * 浮层必须沿用 `image-output-settings-*` 这套实测规则，不能换成 `pk-*` 外壳。
 * 拆成独立组件只是为了让提交区只管按钮与禁用态。
 */
export function MultiFusionOutputSettings({
  open,
  ratio,
  resolution,
  onToggle,
  onRatioChange,
  onResolutionChange,
}: {
  open: boolean;
  ratio: string;
  resolution: string;
  onToggle: () => void;
  onRatioChange: (value: string) => void;
  onResolutionChange: (value: string) => void;
}) {
  return (
    <div className="image-output-settings-shell">
      <button
        type="button"
        className="image-output-settings-summary"
        aria-expanded={open}
        onClick={onToggle}
      >
        <span className="image-output-settings-summary-label">高级设置</span>
        <span className="image-output-settings-chip">比例 {ratio}</span>
        <span className="image-output-settings-chip">画质 {resolution.toUpperCase()}</span>
        <ChevronDown size={14} className={open ? 'is-open' : undefined} />
      </button>
      {open && (
        <div className="image-output-settings-popover">
          <div className="image-output-settings-popover-head">
            <h2>高级设置</h2>
            <button
              type="button"
              className="image-output-settings-close"
              aria-label="关闭高级设置"
              title="关闭"
              onClick={onToggle}
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
  );
}
