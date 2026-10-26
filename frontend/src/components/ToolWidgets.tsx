import type { ReactNode } from 'react';
import { Palette } from 'lucide-react';

/**
 * 修图系工具页共享控件 —— 数值均来自参考站 computed styles 实拍:
 *   背景颜色 (background-color-options): 7 项, 透明白底用棋盘格, 自定义带调色盘图标
 *   原图位置 (smart-expand-position-grid): 3x3 方向键九宫格
 *   滑杆 (rotate-angle-range): 标签 + 值 + range (--range-progress 驱动填充)
 *   胶囊选项 (retouch-mode-options / 变体张数): 单选 pill, active 用品牌紫
 */

export interface ColorOption {
  value: string;
  label: string;
  /** CSS 背景 (HEX 或 'transparent') */
  css: string;
}

export const BG_COLOR_SWATCHES: ColorOption[] = [
  { value: 'transparent', label: '透明底', css: 'transparent' },
  { value: '#FFFFFF', label: '白色', css: '#FFFFFF' },
  { value: '#82CEF3', label: '浅蓝', css: '#82CEF3' },
  { value: '#3988E9', label: '蓝色', css: '#3988E9' },
  { value: '#FF0B22', label: '红色', css: '#FF0B22' },
  { value: '#A8001B', label: '深红', css: '#A8001B' },
];

/** 背景/商品颜色选择 (参考站 background-color-option; 选中态: 透明=紫底勾, 其余=紫描边) */
export function ColorSwatchGrid({
  options,
  value,
  onChange,
  onCustom,
  customActive,
  ariaLabel,
}: {
  options: ColorOption[];
  value: string;
  onChange: (v: string) => void;
  onCustom?: () => void;
  customActive?: boolean;
  ariaLabel: string;
}) {
  return (
    <div className="background-color-options" role="radiogroup" aria-label={ariaLabel}>
      {options.map((o) => {
        const active = o.value === value;
        const transparent = o.css === 'transparent';
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={o.label}
            title={o.label}
            className={`background-color-option${transparent ? ' checker' : ''}${active ? ' active' : ''}`}
            onClick={() => onChange(o.value)}
          >
            {transparent ? (
              <i className="background-color-checker" aria-hidden />
            ) : (
              <i className="background-color-fill" style={{ background: o.css }} aria-hidden />
            )}
          </button>
        );
      })}
      {onCustom && (
        <div className="background-custom-picker">
          <button
            type="button"
            className={`background-color-option custom-trigger${customActive ? ' active' : ''}`}
            aria-label="自定义颜色"
            title="自定义颜色"
            onClick={onCustom}
          >
            <Palette size={15} />
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
    <div className="smart-expand-position-grid" role="radiogroup" aria-label="原图位置">
      {POSITION_CELLS.map((c) => (
        <button
          key={c.value}
          type="button"
          role="radio"
          aria-checked={c.value === value}
          aria-label={`原图${c.label}`}
          title={`原图${c.label}`}
          className={c.value === value ? 'active' : ''}
          onClick={() => onChange(c.value)}
        >
          {c.glyph}
        </button>
      ))}
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
    <label className="rotate-angle-range">
      <span>
        {label} <b>{display ?? value}</b>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ ['--range-progress' as string]: `${progress}%` }}
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
}: {
  title?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
  /** 参考站页面级卡片 class（如 background-color-card / product-retouch-card） */
  className?: string;
}) {
  return (
    <section className={`local-redraw-card tool-card${className ? ` ${className}` : ''}`}>
      {title && (
        <div className="card-title-row">
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
    <div className="image-translate-protect">
      <span>{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        className={checked ? 'active' : ''}
        onClick={() => onChange(!checked)}
      >
        <i />
      </button>
    </div>
  );
}
