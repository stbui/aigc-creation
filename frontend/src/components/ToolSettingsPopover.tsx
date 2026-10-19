import { ChevronDown } from 'lucide-react';
import type { ReactNode } from 'react';
import { ratioOptions, resolutionOptions } from '../lib/optionSets';

/**
 * 高级设置浮层（比例 + 画质）—— 工具页通用能力。
 *
 * 2026-10-19 抽取。此前同一段「点击展开 → 比例网格 → 画质网格」在
 * ToolShell + ProductKit / ViralClone / FreeCreation / ProductDetail / MultiFusion 共 5 处重复。
 *
 * 各页差异用 props 表达，而不是各写一份 JSX：
 * - `showRatio` / `showResolution`  —— 参考站部分页面该页无某组（如 product-detail 只有画质）
 * - `resolutionTitle`              —— 参考站该处文案（"分辨率" / "分辨率（积分/权益消耗）"）
 * - `withHeader`                   —— 参考站 free-creation 的浮层带头部与关闭按钮
 */

export interface ToolSettingsPopoverProps {
  open: boolean;
  onToggle: () => void;
  /** showRatio 为 false 时可不传（参考站该页无比例档，如 product-detail） */
  ratio?: string;
  onRatioChange?: (v: string) => void;
  resolution: string;
  onResolutionChange: (v: string) => void;
  showRatio?: boolean;
  showResolution?: boolean;
  resolutionTitle?: string;
  /** 画质项的副标题（如 4K 的"本地算法暂不支持"），缺省用通用文案 */
  resolutionSub?: (value: string) => string;
  /**
   * 浮层容器追加的类名。参考站 free-creation 用 `fc-settings-popover` + 专属头部
   * （1:1 实拍值，不并入通用头部），故头部做成可覆盖而非开关。
   */
  popoverClassName?: string;
  /** 自定义浮层头部（优先级高于 withHeader） */
  header?: ReactNode;
  /** 浮层容器的 role/aria（free-creation 参考站为 dialog） */
  popoverRole?: string;
  popoverAriaLabel?: string;
  onClose?: () => void;
}

export function ToolSettingsPopover({
  open,
  onToggle,
  ratio,
  onRatioChange,
  resolution,
  onResolutionChange,
  showRatio = true,
  showResolution = true,
  resolutionTitle = '分辨率',
  popoverClassName,
  header,
  popoverRole,
  popoverAriaLabel,
  onClose,
}: ToolSettingsPopoverProps) {
  if (!showRatio && !showResolution) return null;

  return (
    <div className="pk-settings-shell">
      <button
        type="button"
        className={`pk-settings-summary${open ? ' pk-settings-summary-open' : ''}`}
        aria-expanded={open}
        onClick={onToggle}
      >
        <span className="pk-settings-label">高级设置</span>
        {showRatio && ratio && <span className="pk-settings-chip">比例 {ratio}</span>}
        {showResolution && <span className="pk-settings-chip">画质 {resolution.toUpperCase()}</span>}
        <ChevronDown size={15} className="pk-settings-chevron" />
      </button>

      {open && (
        <div
          className={popoverClassName ? `pk-settings-popover ${popoverClassName}` : 'pk-settings-popover'}
          {...(popoverRole ? { role: popoverRole } : {})}
          {...(popoverAriaLabel ? { 'aria-label': popoverAriaLabel } : {})}
        >
          {header}
          {showRatio && (
            <div className="pk-settings-group">
              <strong className="pk-settings-group-label">图片比例</strong>
              <div className="pk-ratio-grid">
                {ratioOptions().map((o) => {
                  const v = String(o.value);
                  return (
                    <button
                      key={v}
                      type="button"
                      className={`pk-ratio-option${v === ratio ? ' pk-option-active' : ''}`}
                      aria-pressed={v === ratio}
                      onClick={() => onRatioChange?.(v)}
                    >
                      <small>{v}</small>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {showResolution && (
            <div className="pk-settings-group">
              <strong className="pk-settings-group-label">{resolutionTitle}</strong>
              <div className="pk-resolution-grid">
                {resolutionOptions().map((o) => (
                  <button
                    key={String(o.value)}
                    type="button"
                    className={`pk-resolution-option${o.value === resolution ? ' pk-option-active' : ''}`}
                    aria-pressed={o.value === resolution}
                    disabled={o.disabled}
                    title={o.disabled ? o.sub : undefined}
                    onClick={() => onResolutionChange(String(o.value))}
                  >
                    <strong>{o.label}</strong>
                    <span>{o.sub}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}