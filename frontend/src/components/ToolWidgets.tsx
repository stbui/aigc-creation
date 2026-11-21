import './ToolWidgets.css';
import type { ReactNode } from 'react';
import { Check } from 'lucide-react';

import { DEFAULT_CUSTOM_COLOR, type ColorOption } from '../lib/colorPalette';

/**
 * 修图系工具页共享控件 —— 数值均来自参考站 computed styles 实拍:
 *   背景颜色 (background-color-options): 7 项, 透明白底用棋盘格, 自定义带调色盘图标
 *   原图位置 (smart-expand-position-grid): 3x3 方向键九宫格
 *   滑杆 (rotate-angle-range): 标签 + 值 + range (--range-progress 驱动填充)
 *   胶囊选项 (retouch-mode-options / 变体张数): 单选 pill, active 用品牌紫
 *
 * 色板取值不在这里定义 —— 见 `src/lib/colorPalette`。
 */

/** 背景/商品颜色选择 (参考站 background-color-option 实拍)。 */
export function ColorSwatchGrid({
  options,
  value,
  onChange,
  onCustom,
  customActive,
  customColor,
  ariaLabel,
}: {
  options: ColorOption[];
  value: string;
  onChange: (v: string) => void;
  onCustom?: () => void;
  customActive?: boolean;
  /** 自定义色块的当前颜色；未选中时该块仍显示参考站的彩虹图。 */
  customColor?: string;
  ariaLabel: string;
}) {
  return (
    <div className="background-color-options" aria-label={ariaLabel}>
      {options.map((o) => {
        const active = o.value === value;
        const transparent = o.css === 'transparent';
        const white = o.css.toUpperCase() === '#FFFFFF';
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            aria-label={o.label}
            title={o.label}
            className={`background-color-option${transparent ? ' checker' : ''}${white ? ' white' : ''}${active ? ' active' : ''}`}
            style={transparent || white ? undefined : { background: o.css }}
            onClick={() => onChange(o.value)}
          >
            {active && <Check size={15} strokeWidth={3} aria-hidden />}
          </button>
        );
      })}
      {onCustom && (
        <div className="background-custom-picker">
          <button
            type="button"
            className={`background-color-option custom-trigger${customActive ? ' active custom-selected' : ''}`}
            style={customActive ? { background: customColor ?? DEFAULT_CUSTOM_COLOR } : undefined}
            aria-label="自定义颜色"
            title="自定义颜色"
            aria-pressed={customActive}
            onClick={onCustom}
          >
            <img src="/static/color.svg" alt="" aria-hidden />
            {customActive && <Check size={15} strokeWidth={3} className="custom-check" aria-hidden />}
          </button>
        </div>
      )}
    </div>
  );
}

/** 自定义 HEX 输入 (选中"自定义颜色"时展开) */
export function CustomColorInput({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
}) {
  return (
    <label className="tool-custom-color">
      <span>{label}</span>
      <input value={value} maxLength={7} placeholder="#RRGGBB" onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

const POSITION_CELLS: Array<{ value: string; glyph: string; label: string }> = [
  { value: 'top-left', glyph: '↖', label: '左上' },
  { value: 'top', glyph: '↑', label: '上' },
  { value: 'top-right', glyph: '↗', label: '右上' },
  { value: 'left', glyph: '←', label: '左' },
  { value: 'center', glyph: '⊙', label: '中' },
  { value: 'right', glyph: '→', label: '右' },
  { value: 'bottom-left', glyph: '↙', label: '左下' },
  { value: 'bottom', glyph: '↓', label: '下' },
  { value: 'bottom-right', glyph: '↘', label: '右下' },
];

/** 原图位置九宫格 (参考站 smart-expand-position-grid; center 默认) */
export function PositionGrid({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="grid w-24 grid-cols-[repeat(3,28px)] gap-1" role="radiogroup" aria-label="原图位置">
      {POSITION_CELLS.map((c) => {
        const active = c.value === value;
        return (
          <button
            key={c.value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={`原图${c.label}`}
            title={`原图${c.label}`}
            className={`grid size-7 cursor-pointer place-items-center rounded-[3px] border p-0 text-sm leading-none ${
              active
                ? 'border-[var(--brand-active)] bg-brand-bg text-[color:var(--brand-active)]'
                : 'border-[var(--border-1)] bg-card text-[color:var(--tool-text-2)] hover:border-brand-light hover:text-brand'
            }`}
            onClick={() => onChange(c.value)}
          >
            {c.glyph}
          </button>
        );
      })}
    </div>
  );
}

/** 滑杆行 (参考站 rotate-angle-range; 值实时显示在标签里) */
export function RangeRow({
  label,
  display,
  min,
  max,
  step,
  value,
  onChange,
}: {
  label: string;
  display?: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
}) {
  const progress = max > min ? ((value - min) / (max - min)) * 100 : 0;
  return (
    <label className="grid gap-2 border-t border-[var(--tool-border-8)] pt-2.5">
      <span className="flex items-center justify-between text-xs leading-4 text-[color:var(--text-5)]">
        {label} <b className="font-semibold text-brand tabular-nums">{display ?? value}</b>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ ['--range-progress' as string]: `${progress}%` }}
        className="h-1 w-full cursor-pointer appearance-none rounded-[var(--radius-tag)] bg-[linear-gradient(90deg,var(--brand)_var(--range-progress),var(--tool-surface-3)_var(--range-progress))] outline-none [&::-webkit-slider-thumb]:size-3.5 [&::-webkit-slider-thumb]:cursor-grab [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-[3px] [&::-webkit-slider-thumb]:border-[var(--card-bg)] [&::-webkit-slider-thumb]:bg-brand [&::-webkit-slider-thumb]:shadow-[0_1px_4px_rgba(85,70,216,0.4)] [&::-moz-range-thumb]:size-2.5 [&::-moz-range-thumb]:cursor-grab [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-[3px] [&::-moz-range-thumb]:border-[var(--card-bg)] [&::-moz-range-thumb]:bg-brand [&::-moz-range-thumb]:shadow-[0_1px_4px_rgba(85,70,216,0.4)]"
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}

/** 胶囊单选 (参考站 retouch-mode-options / 变体张数按钮) */
export function PillOptions({
  options,
  value,
  onChange,
  ariaLabel,
  columns,
}: {
  options: Array<{ value: string; label: string }>;
  value: string;
  onChange: (v: string) => void;
  ariaLabel: string;
  columns?: number;
}) {
  return (
    <div
      className={`retouch-mode-options${columns ? ` retouch-mode-options-cols-${columns}` : ''}`}
      role="radiogroup"
      aria-label={ariaLabel}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          className={o.value === value ? 'active' : ''}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** 业务卡 (参考站 local-redraw-card: 白底圆角 + 标题行) */
export function ToolCard({
  title,
  children,
  actions,
  className,
  dense = false,
  titleGap = false,
}: {
  title?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
  /** 参考站页面级卡片 class（如 background-color-card / product-retouch-card） */
  className?: string;
  /** 紧凑内边距与间距（14px），用于颜色卡这类矮卡片 */
  dense?: boolean;
  /** 标题行下方留出 16px 间距，用于标题与内容需要拉开距离的卡片 */
  titleGap?: boolean;
}) {
  return (
    <section
      className={`local-redraw-card tool-card grid gap-4 rounded-[var(--radius-panel)] bg-card p-4${dense ? ' is-dense' : ''}${className ? ` ${className}` : ''}`}
    >
      {title && (
        <div className={`card-title-row${titleGap ? ' has-gap' : ''}`}>
          <h2>{title}</h2>
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

/** 开关 (参考站 image-translate-protect: role=switch, 默认开) */
export function ToolSwitch({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex h-5 items-center justify-between gap-2.5">
      <span className="text-[13px] leading-[17.5px] text-[color:var(--wb-text)]">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        className={`flex h-5 w-9 cursor-pointer items-center rounded-full border-0 p-0 transition-colors ${
          checked ? 'justify-end bg-[color:var(--brand-accent)]' : 'justify-start bg-border'
        }`}
        onClick={() => onChange(!checked)}
      >
        <i className="block size-[18px] rounded-full bg-card shadow-[0_1px_3px_rgba(17,24,39,0.24)] transition-transform" />
      </button>
    </div>
  );
}
