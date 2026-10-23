/**
 * AIGC 可见角标的可配置样式（唯一事实源）。
 *
 * ## 两类字段，语义不同
 *
 * · **渲染字段**（text / font / 配色 / 圆角 / 内边距 / 圆点）
 *   由后台页面用浏览器 Canvas 画进一张 PNG，服务端只把它当位图用。
 *   改动这些字段后必须重新渲染并保存位图 —— 否则位图与 spec 脱节。
 * · **几何字段**（position / scalePercent / minWidthPx / maxWidthPx /
 *   marginPercent / opacity）
 *   在合成阶段实时生效，换图不必重渲染。
 *
 * `specKey` 只覆盖渲染字段：用它判断「库里的位图是不是按当前 spec 画的」。
 * 几何字段变了但位图没变是**正常状态**，不该报「过期」。
 *
 * ## 为什么默认值必须与改造前逐项一致
 *
 * 2026-10-21 之前角标的观感是：半透明深底 + 白字 + 品牌紫圆点，源图 276×88，
 * 合成宽度为图片宽度的 16%（夹在 [64, 276]），右下角，边距 1.5%（至少 6px）。
 * 默认值照抄这组数字，是为了让「没配过任何东西」的部署升级后产出**零变化**。
 */
import { createHash } from 'node:crypto';

export type AigcLabelPosition = 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';

export const AIGC_LABEL_POSITIONS: AigcLabelPosition[] = [
  'bottom-right',
  'bottom-left',
  'top-right',
  'top-left',
];

export interface AigcLabelSpec {
  /**
   * 是否在产出图上合成可见角标（默认 true）。
   *
   * 关闭后**只停用显式标识**，隐式标识（XMP / IPTC）照常写入；
   * 由后台「AI 标识」页控制，属运营决策而非技术开关。
   */
  enabled: boolean;
  /** 角标文案。Jimp 画不出中文，故由后台浏览器渲成位图 */
  text: string;
  /** CSS font-family，原样交给后台页面的 Canvas */
  fontFamily: string;
  /** 字号（2x 渲染基准，合成时会按目标宽度整体缩放） */
  fontSize: number;
  /** 字重 100–900 */
  fontWeight: number;
  /** 字距（CSS px） */
  letterSpacing: number;
  /** 文字颜色 #rrggbb */
  textColor: string;
  /** 底色 #rrggbb */
  backgroundColor: string;
  /** 底色不透明度 0–100 */
  backgroundOpacity: number;
  /** 圆角（2x 渲染基准 px） */
  radius: number;
  /** 水平内边距（2x 渲染基准 px） */
  paddingX: number;
  /** 左侧圆点颜色；空串 = 不画圆点 */
  dotColor: string;
  /** 相对图片的贴放位置 */
  position: AigcLabelPosition;
  /** 角标宽度占图片宽度的百分比 */
  scalePercent: number;
  /** 合成宽度的下限 / 上限（px） */
  minWidthPx: number;
  maxWidthPx: number;
  /** 距图片边缘的边距占图片宽度的百分比（至少 6px） */
  marginPercent: number;
  /** 角标整体不透明度 0–100 */
  opacity: number;
}

/**
 * 默认样式 = 改造前的观感。
 *
 * ⚠️ 改这些值等于改变**所有未自定义部署**的产出外观，属品牌级变更，
 * 先确认再动手（见 CLAUDE.md 的 1:1 复刻纪律）。
 */
export const AIGC_LABEL_DEFAULTS: AigcLabelSpec = {
  enabled: true,
  text: 'AI 生成',
  fontFamily: '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
  fontSize: 40,
  fontWeight: 600,
  letterSpacing: 2,
  textColor: '#ffffff',
  backgroundColor: '#171a2b',
  backgroundOpacity: 72,
  radius: 18,
  paddingX: 26,
  dotColor: '#5546d8',
  position: 'bottom-right',
  scalePercent: 16,
  minWidthPx: 64,
  maxWidthPx: 276,
  marginPercent: 1.5,
  opacity: 100,
};

/** 参与 `specKey` 的字段：只有这些变了，已保存的位图才需要重画 */
export const AIGC_LABEL_RENDER_KEYS = [
  'text',
  'fontFamily',
  'fontSize',
  'fontWeight',
  'letterSpacing',
  'textColor',
  'backgroundColor',
  'backgroundOpacity',
  'radius',
  'paddingX',
  'dotColor',
] as const satisfies ReadonlyArray<keyof AigcLabelSpec>;

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

function clamp(n: unknown, min: number, max: number, fallback: number): number {
  const v = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, v));
}

function hex(v: unknown, fallback: string): string {
  const s = String(v ?? '').trim().toLowerCase();
  return HEX_COLOR.test(s) ? s : fallback;
}

/** 把任意来源（DB / 请求体 / 旧版本）的值收敛成合法 spec，越界即夹紧 */
export function sanitizeAigcLabelSpec(raw: unknown): AigcLabelSpec {
  const src = (raw ?? {}) as Partial<Record<keyof AigcLabelSpec, unknown>>;
  const d = AIGC_LABEL_DEFAULTS;

  const text = String(src.text ?? d.text).trim().slice(0, 20) || d.text;
  const fontFamily = String(src.fontFamily ?? d.fontFamily).trim().slice(0, 120) || d.fontFamily;
  const position = AIGC_LABEL_POSITIONS.includes(src.position as AigcLabelPosition)
    ? (src.position as AigcLabelPosition)
    : d.position;

  const minWidthPx = Math.round(clamp(src.minWidthPx, 16, 2048, d.minWidthPx));
  const maxWidthPx = Math.round(clamp(src.maxWidthPx, minWidthPx, 4096, d.maxWidthPx));

  return {
    // 只有显式 false 才关闭；缺省 / 非法值一律按开启处理（合规默认不能靠猜）
    enabled: src.enabled === false ? false : d.enabled,
    text,
    fontFamily,
    fontSize: Math.round(clamp(src.fontSize, 12, 120, d.fontSize)),
    // 字重按 100 取整：Canvas 只认真实存在的字重档位，写 650 会回落到默认
    fontWeight: Math.round(clamp(src.fontWeight, 100, 900, d.fontWeight) / 100) * 100,
    letterSpacing: Math.round(clamp(src.letterSpacing, 0, 20, d.letterSpacing) * 10) / 10,
    textColor: hex(src.textColor, d.textColor),
    backgroundColor: hex(src.backgroundColor, d.backgroundColor),
    backgroundOpacity: Math.round(clamp(src.backgroundOpacity, 0, 100, d.backgroundOpacity)),
    radius: Math.round(clamp(src.radius, 0, 120, d.radius)),
    paddingX: Math.round(clamp(src.paddingX, 0, 160, d.paddingX)),
    // 圆点允许显式关闭（空串），但不接受非法颜色
    dotColor: src.dotColor === '' ? '' : hex(src.dotColor, d.dotColor),
    position,
    scalePercent: Math.round(clamp(src.scalePercent, 4, 60, d.scalePercent)),
    minWidthPx,
    maxWidthPx,
    marginPercent: Math.round(clamp(src.marginPercent, 0, 10, d.marginPercent) * 10) / 10,
    opacity: Math.round(clamp(src.opacity, 20, 100, d.opacity)),
  };
}

/**
 * 渲染指纹。只哈希渲染字段，顺序固定，保证同一份 spec 跨进程结果一致。
 */
export function aigcLabelSpecKey(spec: AigcLabelSpec): string {
  const subset: Record<string, unknown> = {};
  for (const key of AIGC_LABEL_RENDER_KEYS) subset[key] = spec[key];
  return createHash('sha256').update(JSON.stringify(subset)).digest('hex').slice(0, 32);
}

/** 从 PNG 字节读 IHDR 宽高（不引解码库；位图合法性校验也走这里） */
export function readPngSize(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 24) return null;
  if (buf[0] !== 0x89 || buf.toString('latin1', 1, 4) !== 'PNG') return null;
  if (buf.toString('latin1', 12, 16) !== 'IHDR') return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}
