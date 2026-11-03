/**
 * 色板与颜色换算 —— 抠图 / 换色 / 人工修图的唯一事实源。
 *
 * 2026-11-03 抽取。此前同一套五个预设色写了四份：`ToolWidgets.BG_COLOR_SWATCHES`
 * （无人引用）、`ColorStudio` 的抠图 / 换色两套、`MattingResultEditor.COLOR_HEX`；
 * 「色值 → 中文名」又在两个页面各写一份 —— 换一个预设色要改六个文件。
 *
 * 两套色板的差异是**提交语义**，不是色值：抠图把后端认识的 token 名（`white` /
 * `light-blue` …）当参数发出去，换色直接发 HEX。色值只在 `PRESET_COLORS` 定义一次，
 * 两套色板从它派生；新增预设色只改那张表。
 *
 * 本文件只放数据与纯函数，不依赖 React。
 */

export interface ColorOption {
  value: string;
  label: string;
  /** CSS 背景 (HEX 或 'transparent') */
  css: string;
}

export interface PresetColor {
  /** 后端色名（抠图能力认这一套） */
  key: string;
  /** 实际色值 */
  hex: string;
  label: string;
}

/** 五个预设色 —— 换色值只改这里，两套色板与两处映射同时生效 */
export const PRESET_COLORS: readonly PresetColor[] = [
  { key: 'white', hex: '#FFFFFF', label: '白色' },
  { key: 'light-blue', hex: '#82CEF3', label: '浅蓝' },
  { key: 'blue', hex: '#3988E9', label: '蓝色' },
  { key: 'red', hex: '#FF0B22', label: '红色' },
  { key: 'dark-red', hex: '#A8001B', label: '深红' },
];

function toRecord<T>(pairs: readonly (readonly [string, T])[], init: Record<string, T> = {}): Record<string, T> {
  const out: Record<string, T> = { ...init };
  for (const [key, value] of pairs) out[key] = value;
  return out;
}

/** 抠图色板：透明底 + 预设色，value 用后端 token 名 */
export const MATTING_COLOR_SWATCHES: ColorOption[] = [
  { value: 'transparent', label: '透明底', css: 'transparent' },
  ...PRESET_COLORS.map((color) => ({ value: color.key, label: color.label, css: color.hex })),
];

/** 换色色板：value 直接是 HEX（提交给模型的就是色值） */
export const RECOLOR_COLOR_SWATCHES: ColorOption[] = PRESET_COLORS.map((color) => ({
  value: color.hex,
  label: color.label,
  css: color.hex,
}));

/** token 名 → HEX（人工修图的画布底色 / 结果图合成用） */
export const COLOR_HEX: Record<string, string> = toRecord<string>(
  PRESET_COLORS.map((color) => [color.key, color.hex] as const),
  { transparent: 'transparent' },
);

/**
 * 色值 / 色名 → 中文名。
 *
 * 抠图的结果标签可能拿到 token 名（`white`）也可能拿到 HEX（`#FFFFFF`），
 * 两种都登记；换色页只用 HEX 部分。
 */
export const COLOR_LABEL: Record<string, string> = toRecord<string>(
  PRESET_COLORS.flatMap((color) => [
    [color.key, color.label] as const,
    [color.hex, color.label] as const,
  ]),
  { transparent: '透明底', custom: '自定义' },
);

/** 自定义色的兜底：品牌紫。取色面板初始值、非法输入回落都用它 */
export const DEFAULT_CUSTOM_COLOR = '#5546D8';

/** `#RRGGBB` 归一化；不合法返回 null */
export function normalizeHexColor(value: string): string | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(value.trim());
  return match ? `#${match[1].toUpperCase()}` : null;
}

export function isValidHexColor(value: string): boolean {
  return normalizeHexColor(value) !== null;
}

/**
 * 读取设计令牌的当前实值。
 *
 * canvas 绘制与二维码库只接受具体颜色，吃不了 `var(--token)`；直接写裸 hex 会让
 * 令牌调整后这两处停在旧值 —— 邀请海报的渐变浅端就曾停在令牌收拢前的 `#8064F6`。
 * 读不到时（测试环境无样式表 / 非浏览器）回落到 fallback。
 */
export function tokenColor(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

/**
 * 二维码前景 / 背景。
 *
 * 二维码必须高对比：前景用标题色，背景用卡片白。三处生成二维码（扫码登录 /
 * 手机上传 / 邀请海报）此前各写一遍 `#171a2b` 与 `#ffffff`，大小写还不一致。
 */
export function qrColors(): { dark: string; light: string } {
  return {
    dark: tokenColor('--text-strong', '#171A2B'),
    light: tokenColor('--card-bg', '#FFFFFF'),
  };
}
