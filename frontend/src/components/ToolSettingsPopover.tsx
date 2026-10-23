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
 * - `resolutionTitle`              —— 分组标题，默认即参考站唯一取值（"分辨率（积分/权益消耗）"）
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
  /**
   * 当前能力 id。用于判断 4K 档位是否可选 —— 只有该能力此刻有云端通道
   * （`runtime.remoteAvailable`）才放开；不传按不可用处理。
   */
  capabilityId?: string;
  showRatio?: boolean;
  showResolution?: boolean;
  /** 分组标题（默认即参考站取值）。副文由 `lib/optionSets.resolutionOptions()` 统一给出，不另开覆盖口子 */
  resolutionTitle?: string;
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
  capabilityId,
  showRatio = true,
  showResolution = true,
  // 参考站该分组标题的唯一取值（bundle: `resolutionLabel:'分辨率（积分/权益消耗）'`），
  // 各页不再各自传值 —— 单处定义，避免出现一半页面短标题、一半长标题。
  resolutionTitle = '分辨率（积分/权益消耗）',
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
                {resolutionOptions(capabilityId).map((o) => (
                  <button
                    key={String(o.value)}
                    type="button"
                    className={`pk-resolution-option${o.value === resolution ? ' pk-option-active' : ''}`}
                    aria-pressed={o.value === resolution}
                    disabled={o.disabled}
                    title={o.disabled ? o.disabledReason : undefined}
                    onClick={() => onResolutionChange(String(o.value))}
                  >
                    {/* 参考站卡片主文是短档位 1K/2K/4K (后端 label 是 "1K (1024px)",
                        放进 116px 宽的卡片里会在中间折行), 具体像素值放副文。
                        非 "1k/2k/4k" 形态的取值仍回落到后端 label, 不硬造缩写。 */}
                    <strong>{shortResolutionLabel(o.value, o.label)}</strong>
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

/**
 * 分辨率卡的短档位文案。
 *
 * 参考站 `.image-output-resolution-option strong` 里只有 `1K` / `2K` / `4K`，
 * 尺寸说明在 `span`（11px 灰字）。后端 `QUALITY_OPTIONS` 的 label 是
 * `1K (1024px)` —— 直接塞进 116px 宽的卡片会折行，故这里按取值缩写；
 * 取值不是 `Nk` 形态时原样回落到 label，不臆造缩写。
 */
function shortResolutionLabel(value: unknown, fallback: string): string {
  const v = String(value);
  return /^\d+k$/i.test(v) ? v.toUpperCase() : fallback;
}