import type { CSSProperties } from 'react';
import { API_ROOT, unwrapEnvelope } from './http';
import type { PublicAigcLabel } from '../types/api';

/**
 * AIGC 标识的公开展示参数。
 *
 * 图片产出的角标由后端合成进像素（用户下载/转发也带着），前端无需再画；
 * 视频没有 ffmpeg，落不了容器元数据，只能由播放器按同一份文案补显式标识。
 *
 * 拉取失败时回落到内置文案 —— 角标是合规要求，不能因为一次配置请求失败
 * 就不显示。缓存是模块级的：一页里多个视频共用一次请求。
 */

export const AIGC_LABEL_FALLBACK: PublicAigcLabel = {
  enabled: true,
  text: 'AI 生成',
  textColor: '#ffffff',
  backgroundColor: '#171a2b',
  backgroundOpacity: 72,
  radius: 18,
  dotColor: '#5546d8',
  position: 'bottom-right',
};

let cache: PublicAigcLabel | null = null;
let inflight: Promise<PublicAigcLabel> | null = null;

export async function loadAigcLabel(force = false): Promise<PublicAigcLabel> {
  if (cache && !force) return cache;
  if (inflight && !force) return inflight;

  inflight = (async () => {
    try {
      const res = await fetch(`${API_ROOT}/aigc-label`);
      if (!res.ok) throw new Error(`AIGC 标识配置加载失败（${res.status}）`);
      cache = unwrapEnvelope<PublicAigcLabel>(await res.json());
      return cache;
    } catch {
      // 网络/后端异常不阻断播放器角标：用内置文案
      return AIGC_LABEL_FALLBACK;
    }
  })();

  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}

/** #rrggbb + 不透明度（0-100）→ rgba() */
export function hexToRgba(hex: string, opacity: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return `rgba(23, 26, 43, ${opacity / 100})`;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 0xff}, ${(n >> 8) & 0xff}, ${n & 0xff}, ${opacity / 100})`;
}

/**
 * 把角标样式映射成播放器角标的 CSS。
 *
 * 位图按 2x、40px 字号渲染，播放器角标是 12px —— 圆角按约 0.3 的缩放比折算，
 * 否则 18px 的圆角画在 12px 字上会变成一个胶囊。
 */
export function aigcBadgeStyle(label: PublicAigcLabel): CSSProperties {
  return {
    background: hexToRgba(label.backgroundColor, label.backgroundOpacity),
    color: label.textColor,
    borderRadius: Math.max(2, Math.round(label.radius * 0.3)),
  };
}
