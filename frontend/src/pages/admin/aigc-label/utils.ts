/**
 * AI 标识的纯函数与外部工具入口 —— 目录内文件的唯一外部工具来源。
 *
 * 位图在浏览器里画：中文无法在服务端零依赖地栅格化（Jimp 内置字体只有
 * ASCII），服务端合成时只做缩放、定位与透明度。
 */

import type { AigcLabelSpec } from '../../../types/api';
import { hexToRgba } from '../../../lib/aigc-label';
import { RENDER_SCALE } from './constants';

export { hexToRgba };

/** 按样式把角标画成一张 PNG（透明底） */
export function renderBadgeCanvas(spec: AigcLabelSpec): HTMLCanvasElement {
  const S = RENDER_SCALE;
  const fontSize = spec.fontSize * S;
  const font = `${spec.fontWeight} ${fontSize}px ${spec.fontFamily}`;

  const probe = document.createElement('canvas').getContext('2d');
  if (!probe) throw new Error('当前浏览器不支持 Canvas，无法生成角标位图');
  // letterSpacing 是较新的属性；不支持时按 0 处理（测量与绘制都不含字距，仍自洽）
  const spacing = `${spec.letterSpacing * S}px`;
  (probe as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = spacing;
  probe.font = font;
  const textW = Math.ceil(probe.measureText(spec.text || ' ').width);

  const dotD = spec.dotColor ? Math.round(spec.fontSize * 0.4 * S) : 0;
  const gap = spec.dotColor ? Math.round(spec.fontSize * 0.35 * S) : 0;
  const padX = Math.round(spec.paddingX * S);
  const width = Math.max(1, padX * 2 + dotD + gap + textW);
  const height = Math.max(1, Math.round(spec.fontSize * 2.2 * S));
  const radius = Math.min(spec.radius * S, Math.floor(height / 2));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('当前浏览器不支持 Canvas，无法生成角标位图');

  ctx.fillStyle = hexToRgba(spec.backgroundColor, spec.backgroundOpacity);
  ctx.beginPath();
  ctx.roundRect(0, 0, width, height, radius);
  ctx.fill();

  let x = padX;
  if (dotD > 0) {
    ctx.fillStyle = spec.dotColor;
    ctx.beginPath();
    ctx.arc(x + dotD / 2, height / 2, dotD / 2, 0, Math.PI * 2);
    ctx.fill();
    x += dotD + gap;
  }

  // 调整 canvas 尺寸会重置上下文，字体/字距必须在这之后设置
  ctx.font = font;
  (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = spacing;
  ctx.fillStyle = spec.textColor;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(spec.text, x, height / 2);

  return canvas;
}

/** 示例底图 + 按服务端规则合成角标 */
export function drawPreview(
  canvas: HTMLCanvasElement,
  spec: AigcLabelSpec,
  badge: HTMLCanvasElement,
): void {
  const W = canvas.width;
  const H = canvas.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, W, H);

  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#eef2f8');
  bg.addColorStop(1, '#d9e0ee');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // 示意「一张商品图」：不能拿真实素材冒充预览，但也不能是个纯色块
  ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
  ctx.beginPath();
  ctx.roundRect(W * 0.26, H * 0.16, W * 0.48, H * 0.66, 28);
  ctx.fill();
  ctx.fillStyle = '#b9c4d8';
  ctx.beginPath();
  ctx.arc(W * 0.5, H * 0.42, H * 0.17, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#9aa8c1';
  ctx.beginPath();
  ctx.roundRect(W * 0.4, H * 0.62, W * 0.2, H * 0.07, 10);
  ctx.fill();

  ctx.fillStyle = 'rgba(23, 26, 43, 0.32)';
  ctx.font = '14px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('示例底图（非真实产出）', 18, H - 18);

  if (!spec.enabled) {
    // 关闭态不画角标，但要说清楚「少了什么」，避免预览空着让人以为坏了
    ctx.fillStyle = 'rgba(23, 26, 43, 0.55)';
    ctx.font = '16px "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('可见角标已关闭：产出图不再显示角标', W / 2, H * 0.9);
    return;
  }

  let targetW = Math.round(
    Math.min(spec.maxWidthPx, Math.max(spec.minWidthPx, (W * spec.scalePercent) / 100)),
  );
  targetW = Math.max(1, Math.min(targetW, W));
  let targetH = Math.max(1, Math.round((badge.height / Math.max(1, badge.width)) * targetW));
  if (targetH > H) {
    targetH = H;
    targetW = Math.max(1, Math.round((badge.width / badge.height) * targetH));
  }

  const margin = Math.max(6, Math.round((W * spec.marginPercent) / 100));
  const x = spec.position.endsWith('right')
    ? Math.max(0, W - targetW - margin)
    : Math.min(margin, Math.max(0, W - targetW));
  const y = spec.position.startsWith('bottom')
    ? Math.max(0, H - targetH - margin)
    : Math.min(margin, Math.max(0, H - targetH));

  ctx.globalAlpha = spec.opacity / 100;
  ctx.drawImage(badge, x, y, targetW, targetH);
  ctx.globalAlpha = 1;
}
