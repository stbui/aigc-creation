import { Raster } from './canvas.js';
import { encodePng } from './png.js';
import { measureText, wrapText } from './font.js';
import { paletteFrom, seededRng, sha256hex, clamp, randInt } from '../hash.js';

/**
 * 文生图的「仿真模型」实现。
 *
 * 输出是**真实生成的 PNG 字节**：按 prompt 派生配色与构图，用光栅操作
 * 一层层画出来，再交给自研 PNG 编码器。图片内容不是任何固定素材，
 * 但也不代表真实模型的审美 —— 它只用于证明「通道取数 → 下载 → 落库」
 * 这条链路是通的。
 *
 * 确定性：同一 prompt + model + seed 永远得到同一张图，联调时可复现。
 */

const DEFAULT_SIZE = 1024;

export function parseSize(size, maxPixels = 2_400_000) {
  if (typeof size === 'string') {
    const m = /^(\d{2,5})\s*[x×]\s*(\d{2,5})$/i.exec(size.trim());
    if (m) {
      let width = Number(m[1]);
      let height = Number(m[2]);
      width = clamp(Math.round(width), 64, 2048);
      height = clamp(Math.round(height), 64, 2048);
      // 总像素上限：防止 2048x2048 的 zlib 压缩把单次请求拖到几秒
      const ratio = Math.sqrt(maxPixels / (width * height));
      if (ratio < 1) {
        width = Math.max(64, Math.round(width * ratio));
        height = Math.max(64, Math.round(height * ratio));
      }
      return { width, height };
    }
  }
  return { width: DEFAULT_SIZE, height: DEFAULT_SIZE };
}

/** 从 prompt 里提取可渲染的 ASCII 片段（点阵字体只有 ASCII 字形）。 */
export function asciiExcerpt(prompt, maxLen = 160) {
  const ascii = String(prompt ?? '')
    .replace(/[^\x20-\x7e]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!ascii) return 'VISUAL SYNTHESIS';
  return ascii.length > maxLen ? `${ascii.slice(0, maxLen - 1)}.` : ascii;
}

/**
 * @param {{
 *   prompt: string,
 *   model: string,
 *   size?: string,
 *   seed?: number|string,
 *   imageCount?: number,
 *   maxPixels?: number,
 * }} opts
 */
export function generateImage(opts) {
  const prompt = String(opts.prompt ?? '').trim();
  const model = String(opts.model ?? 'mock-image');
  const seed = opts.seed ?? 0;
  const { width, height } = parseSize(opts.size, opts.maxPixels);
  const digest = sha256hex(`${prompt}|${model}|${seed}`);
  const rng = seededRng(Buffer.from(digest, 'hex'));
  const palette = paletteFrom(`${prompt}|${model}|${seed}`);

  const canvas = new Raster(width, height, palette.background);
  const unit = Math.min(width, height);

  // 1) 底色：竖向渐变 + 两团径向光晕
  canvas.verticalGradient(palette.background, palette.backgroundEnd);
  canvas.radialGlow(width * (0.16 + rng() * 0.18), height * (0.18 + rng() * 0.2), unit * 0.7, palette.accent, 0.34);
  canvas.radialGlow(width * (0.68 + rng() * 0.2), height * (0.62 + rng() * 0.24), unit * 0.55, palette.highlight, 0.18);

  // 2) 网格 —— 给画面一点「设计稿」的骨架
  const gridStep = Math.max(24, Math.round(unit / 14));
  for (let x = gridStep; x < width; x += gridStep) {
    canvas.fillRect(x, 0, 1, height, palette.ink, 0.035);
  }
  for (let y = gridStep; y < height; y += gridStep) {
    canvas.fillRect(0, y, width, 1, palette.ink, 0.035);
  }

  // 3) 主体：同心环 + 漂浮圆斑，位置与半径由种子决定
  const cx = width * (0.42 + rng() * 0.18);
  const cy = height * (0.38 + rng() * 0.18);
  const baseR = unit * (0.2 + rng() * 0.08);
  for (let i = 0; i < 5; i += 1) {
    canvas.ring(cx, cy, baseR - i * unit * 0.035, Math.max(2, unit * 0.004), i % 2 ? palette.highlight : palette.accent, 0.42);
  }
  const blobCount = randInt(rng, 7, 12);
  for (let i = 0; i < blobCount; i += 1) {
    const r = unit * (0.015 + rng() * 0.055);
    const bx = rng() * width;
    const by = rng() * height;
    const color = rng() > 0.5 ? palette.accent : palette.highlight;
    canvas.fillCircle(bx, by, r, color, 0.1 + rng() * 0.16);
  }
  // 一道斜线，制造动势
  canvas.drawLine(
    width * 0.08,
    height * (0.2 + rng() * 0.2),
    width * 0.92,
    height * (0.72 + rng() * 0.16),
    palette.accentSoft,
    Math.max(2, Math.round(unit * 0.004)),
    0.5,
  );

  // 4) 左上角标识
  const margin = Math.round(unit * 0.045);
  const titleScale = Math.max(2, Math.round(unit / 260));
  const smallScale = Math.max(1, Math.round(unit / 420));
  canvas.drawText('MOCK IMAGE', margin, margin, { scale: titleScale, color: palette.accent });
  canvas.drawText(model.toUpperCase().slice(0, 34), margin, margin + titleScale * 10, {
    scale: smallScale,
    color: palette.inkMuted,
  });

  // 5) 右上角尺寸徽标
  const badge = `${width} X ${height}`;
  const badgeW = measureText(badge, smallScale) + margin;
  const badgeH = 7 * smallScale + Math.round(margin * 0.9);
  canvas.roundRect(width - margin - badgeW, margin, badgeW, badgeH, Math.round(badgeH / 2), palette.panel, 0.72);
  canvas.drawText(badge, width - margin - badgeW + Math.round(margin * 0.5), margin + Math.round(margin * 0.42), {
    scale: smallScale,
    color: palette.ink,
  });

  // 6) 底部提示词面板（只画 ASCII 摘要；全文进 PNG tEXt）
  const excerpt = asciiExcerpt(prompt);
  const scale = Math.max(1, Math.round(unit / 340));
  const pad = Math.max(10, Math.round(unit * 0.022));
  const maxTextWidth = width - margin * 2 - pad * 2;
  const lines = wrapText(excerpt, maxTextWidth, scale).slice(0, 3);
  const lineHeight = 7 * scale + Math.round(scale * 4);
  const panelW = width - margin * 2;
  const panelH = pad * 2 + Math.max(1, lines.length) * lineHeight + Math.round(scale * 12);
  const panelY = height - margin - panelH;
  canvas.roundRect(margin, panelY, panelW, panelH, Math.round(pad * 0.8), palette.panel, 0.82);
  canvas.fillRect(margin + pad, panelY + pad, Math.max(2, Math.round(unit * 0.004)), panelH - pad * 2, palette.accent, 0.9);
  let ty = panelY + pad + Math.round(scale * 3);
  for (const line of lines) {
    canvas.drawText(line, margin + pad * 2, ty, { scale, color: palette.ink });
    ty += lineHeight;
  }
  canvas.drawText(
    `SEED ${String(opts.seed ?? 0).slice(0, 12)}  REF ${opts.imageCount ?? 0}`,
    margin + pad * 2,
    panelY + panelH - pad - 7 * smallScale,
    { scale: smallScale, color: palette.inkMuted },
  );

  // 7) 颗粒
  canvas.speckle(rng, Math.round((width * height) / 900), 0.05);

  const buffer = encodePng({
    width,
    height,
    rgb: canvas.toRGB(),
    texts: {
      Software: 'mock-model-gateway',
      Comment: prompt,
      Model: model,
      Seed: String(opts.seed ?? 0),
    },
  });

  return {
    buffer,
    width,
    height,
    mime: 'image/png',
    ext: 'png',
    revisedPrompt: `Simulated render of: ${prompt}`,
  };
}
