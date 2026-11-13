import '../styles/image-output-settings.css';
import { ChevronDown, X } from 'lucide-react';
import { type ReactNode, useEffect, useRef } from 'react';
import { ratioOptions, resolutionOptions } from '../lib/optionSets';
import { Button } from '../ui';

/**
 * 高级设置浮层（比例 + 画质）—— 工具页通用能力。
 *
 * 2026-10-19 抽取。此前同一段「点击展开 → 比例网格 → 画质网格」在
 * ToolShell + ProductKit / ViralClone / FreeCreation / ProductDetail / MultiFusion 共 5 处重复。
 *
 * 各页差异用 props 表达，而不是各写一份 JSX：
 * - `showRatio` / `showResolution`  —— 参考站部分页面只展示其中一组
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
  /**
   * 所选模型的 `imageResolution` 可取档位（`capabilitySpec.options.imageResolution.values`）。
   * 提供时优先按它禁用不支持的档位，避免「界面可选 4K、提交后被拒或降档」。
   */
  resolutionValues?: readonly unknown[] | null;
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
  /**
   * 模型选择器（P5）。由 `ModelPicker` 提供，渲染在比例 / 画质之上。
   *
   * 放在高级设置里而不是提交区：工具页的左栏宽度固定，再加一行常驻控件会挤掉
   * 上传区；而「换模型 = 换价」与画质档位是同一类决策，放在一起用户才会同时看到。
   */
  modelPicker?: ReactNode;
}

export function ToolSettingsPopover({
  open,
  onToggle,
  ratio,
  onRatioChange,
  resolution,
  onResolutionChange,
  capabilityId,
  resolutionValues,
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
  modelPicker,
}: ToolSettingsPopoverProps) {
  const shellRef = useRef<HTMLDivElement>(null);

  // 浮层是绝对定位的展开面板，不是 Modal；补上用户对浮层的通用预期：
  // 点面板外或按 Esc 都能收起，避免移动端只能再点一次「高级设置」。
  useEffect(() => {
    if (!open) return;
    const close = () => (onClose ?? onToggle)();
    const onPointerDown = (event: PointerEvent) => {
      if (shellRef.current?.contains(event.target as Node)) return;
      close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose, onToggle, open]);

  if (!showRatio && !showResolution && !modelPicker) return null;

  return (
    <div className="pk-settings-shell" ref={shellRef}>
      <Button
        type="text"
        className={`pk-settings-summary u-font-12${open ? ' pk-settings-summary-open' : ''}`}
        aria-expanded={open}
        onClick={onToggle}
      >
        <span className="pk-settings-label u-font-12">高级设置</span>
        {showRatio && ratio && (
          <span className="pk-settings-chip u-font-12">比例 {ratioLabel(ratio)}</span>
        )}
        {showResolution && (
          <span className="pk-settings-chip u-font-12">画质 {resolution.toUpperCase()}</span>
        )}
        <ChevronDown size={15} className="pk-settings-chevron size-[15px]" />
      </Button>

      {open && (
        <div
          className={
            popoverClassName ? `pk-settings-popover ${popoverClassName}` : 'pk-settings-popover'
          }
          {...(popoverRole ? { role: popoverRole } : {})}
          {...(popoverAriaLabel ? { 'aria-label': popoverAriaLabel } : {})}
        >
          {header ?? (
            <div className="pk-settings-popover-head">
              <h2 className="u-font-16">高级设置</h2>
              <Button
                type="text"
                className="pk-settings-close"
                aria-label="关闭高级设置"
                title="关闭"
                onClick={onClose ?? onToggle}
              >
                <X size={18} className="size-[18px]" />
              </Button>
            </div>
          )}
          {modelPicker}
          {showRatio && (
            <div className="pk-settings-group">
              <strong className="pk-settings-group-label">图片比例</strong>
              <div className="pk-ratio-grid">
                {ratioOptions(capabilityId).map((o) => {
                  const v = String(o.value);
                  return (
                    <Button
                      key={v}
                      type="text"
                      className={`pk-ratio-option${v === ratio ? ' pk-option-active' : ''}`}
                      aria-pressed={v === ratio}
                      onClick={() => onRatioChange?.(v)}
                    >
                      <small>{shortRatioLabel(o.label, v)}</small>
                    </Button>
                  );
                })}
              </div>
            </div>
          )}
          {showResolution && (
            <div className="pk-settings-group">
              <strong className="pk-settings-group-label">{resolutionTitle}</strong>
              <div className="pk-resolution-grid">
                {resolutionOptions(capabilityId, resolutionValues).map((o) => (
                  <Button
                    key={String(o.value)}
                    type="text"
                    className={`pk-resolution-option u-p-8${o.value === resolution ? ' pk-option-active' : ''}`}
                    aria-pressed={o.value === resolution}
                    disabled={o.disabled}
                    title={o.disabled ? o.disabledReason : undefined}
                    onClick={() => onResolutionChange(String(o.value))}
                  >
                    {/* 参考站卡片主文是短档位 1K/2K/4K (后端 label 是 "1K (1024px)",
                        放进 116px 宽的卡片里会在中间折行), 具体像素值放副文。
                        非 "1k/2k/4k" 形态的取值仍回落到后端 label, 不硬造缩写。 */}
                    <strong>{shortResolutionLabel(o.value, o.label)}</strong>
                    <span className="u-font-12">{o.sub}</span>
                  </Button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ratioLabel(value: string): string {
  return value === 'original' ? '原比例' : value;
}

/**
 * 比例卡文案：原比例用中文，其余沿用后端 label/value。
 *
 * 参考站高级设置摘要与卡片都显示「原比例」，不能把内部枚举值 original
 * 直接暴露给用户。
 */
function shortRatioLabel(label: string | undefined, value: string): string {
  return label?.trim() || ratioLabel(value);
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
