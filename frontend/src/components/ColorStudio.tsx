import { useMemo } from 'react';
import { Pipette, RotateCcw } from 'lucide-react';
import { ColorSwatchGrid, type ColorOption } from './ToolWidgets';

/**
 * 参考站色板 + 自定义颜色面板。
 *
 * 背景抠图与商品换色共用同一套交互：预设色、系统取色器、HEX、色相滑杆、
 * 透明度滑杆、12 个常用色与「无填充」。组件只负责呈现与换算，提交语义由
 * 页面决定：抠图把 custom 作为 selectedColor，换色则提交解析后的 HEX。
 */

export const MATTING_COLOR_SWATCHES: ColorOption[] = [
  { value: 'transparent', label: '透明底', css: 'transparent' },
  { value: 'white', label: '白色', css: '#FFFFFF' },
  { value: 'light-blue', label: '浅蓝', css: '#82CEF3' },
  { value: 'blue', label: '蓝色', css: '#3988E9' },
  { value: 'red', label: '红色', css: '#FF0B22' },
  { value: 'dark-red', label: '深红', css: '#A8001B' },
];

export const RECOLOR_COLOR_SWATCHES: ColorOption[] = [
  { value: '#FFFFFF', label: '白色', css: '#FFFFFF' },
  { value: '#82CEF3', label: '浅蓝', css: '#82CEF3' },
  { value: '#3988E9', label: '蓝色', css: '#3988E9' },
  { value: '#FF0B22', label: '红色', css: '#FF0B22' },
  { value: '#A8001B', label: '深红', css: '#A8001B' },
];

const COLOR_PRESETS = [
  '#000000',
  '#FFFFFF',
  '#F5F5F5',
  '#FFD400',
  '#FF7A00',
  '#FF0B22',
  '#A8001B',
  '#7B2FF7',
  '#5546D8',
  '#3988E9',
  '#82CEF3',
  '#22C55E',
];

export function normalizeHexColor(value: string): string | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(value.trim());
  return m ? `#${m[1].toUpperCase()}` : null;
}

export function isValidHexColor(value: string): boolean {
  return normalizeHexColor(value) !== null;
}

function hexToHsv(hex: string): { h: number; s: number; v: number } {
  const normalized = normalizeHexColor(hex) ?? '#5546D8';
  const n = parseInt(normalized.slice(1), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

function hsvToHex(h: number, s: number, v: number): string {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const to = (n: number) => Math.round((n + m) * 255).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`.toUpperCase();
}

interface EyeDropperResult {
  sRGBHex: string;
}
interface EyeDropperInstance {
  open: () => Promise<EyeDropperResult>;
}
type EyeDropperCtor = new () => EyeDropperInstance;

export function ColorStudio({
  options,
  value,
  onChange,
  customColor,
  onCustomColor,
  customAlpha = 100,
  onCustomAlpha,
  allowAlpha = true,
  clearLabel = '无填充',
  onClear,
  ariaLabel,
}: {
  options: ColorOption[];
  value: string;
  onChange: (value: string) => void;
  customColor: string;
  onCustomColor: (value: string) => void;
  customAlpha?: number;
  onCustomAlpha?: (value: number) => void;
  allowAlpha?: boolean;
  clearLabel?: string;
  onClear?: () => void;
  ariaLabel: string;
}) {
  const hex = normalizeHexColor(customColor) ?? '#5546D8';
  const customHexInvalid = value === 'custom' && !isValidHexColor(customColor);
  const hsv = useMemo(() => hexToHsv(hex), [hex]);
  const pickerSupported = typeof window !== 'undefined' && 'EyeDropper' in window;

  const pickScreenColor = async () => {
    const Ctor = (window as unknown as { EyeDropper?: EyeDropperCtor }).EyeDropper;
    if (!Ctor) return;
    try {
      const result = await new Ctor().open();
      const picked = normalizeHexColor(result.sRGBHex);
      if (picked) onCustomColor(picked);
    } catch {
      // 用户按 Esc 取消取色是正常操作，不弹错误
    }
  };

  return (
    <div className="color-studio">
      <ColorSwatchGrid
        options={options}
        value={value}
        onChange={(next) => {
          if (next === 'custom') {
            onChange('custom');
            onCustomColor(hex);
          } else {
            onChange(next);
          }
        }}
        onCustom={() => {
          onChange('custom');
          onCustomColor(hex);
        }}
        customActive={value === 'custom'}
        ariaLabel={ariaLabel}
      />

      {value === 'custom' && (
        <div className="color-studio-panel">
          <div className="color-studio-row">
            <label className="color-studio-native" title="打开系统拾色器">
              <input
                type="color"
                value={hex}
                aria-label="选择自定义颜色"
                onChange={(e) => onCustomColor(e.target.value.toUpperCase())}
              />
              <i style={{ background: hex }} />
            </label>
            <label className="color-studio-hex">
              <span>HEX</span>
              <input
                value={customColor}
                maxLength={7}
                placeholder="#RRGGBB"
                aria-invalid={customHexInvalid}
                onChange={(e) => {
                  const next = e.target.value;
                  const normalized = normalizeHexColor(next);
                  if (normalized) onCustomColor(normalized);
                  else onCustomColor(next.toUpperCase());
                }}
              />
            </label>
            <button
              type="button"
              className="color-studio-eyedropper"
              aria-label="从屏幕取色"
              title={pickerSupported ? '从屏幕取色' : '当前浏览器不支持屏幕取色'}
              disabled={!pickerSupported}
              onClick={() => void pickScreenColor()}
            >
              <Pipette size={15} />
            </button>
          </div>
          {customHexInvalid && (
            <p className="color-studio-hex-error" role="alert">
              请输入有效的 HEX 颜色，例如 #5546D8
            </p>
          )}

          <label className="color-studio-slider">
            <span>
              色相 <b>{Math.round(hsv.h)}°</b>
            </span>
            <input
              type="range"
              min={0}
              max={359}
              step={1}
              value={Math.round(hsv.h)}
              style={{ ['--hue' as string]: hsv.h }}
              onChange={(e) => onCustomColor(hsvToHex(Number(e.target.value), hsv.s || 0.75, hsv.v || 0.85))}
            />
          </label>

          {allowAlpha && onCustomAlpha && (
            <label className="color-studio-slider">
              <span>
                不透明度 <b>{customAlpha}%</b>
              </span>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={customAlpha}
                onChange={(e) => onCustomAlpha(Number(e.target.value))}
              />
            </label>
          )}

          <div className="color-studio-presets" role="group" aria-label="常用颜色">
            {COLOR_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                aria-label={preset}
                title={preset}
                className={hex === preset ? 'active' : ''}
                style={{ background: preset }}
                onClick={() => onCustomColor(preset)}
              />
            ))}
          </div>

          <div className="color-studio-actions">
            <button
              type="button"
              className="color-studio-clear"
              onClick={() => (onClear ? onClear() : onChange('transparent'))}
            >
              <RotateCcw size={13} />
              {clearLabel}
            </button>
            <span className="color-studio-preview" aria-label="颜色预览">
              <i style={{ background: hex, opacity: allowAlpha ? customAlpha / 100 : 1 }} />
              {hex}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
