import { Raster } from '../image/canvas.js';
import { asciiExcerpt } from '../image/generator.js';
import { measureText, wrapText } from '../image/font.js';
import { buildMp4 } from './mp4.js';
import { encodeAvcFrames } from './h264.js';
import { paletteFrom, seededRng, sha256hex, clamp } from '../hash.js';

/**
 * 文生视频的「仿真模型」实现。
 *
 * 真实做三件事：
 *   1. 按 prompt 渲染一串动画帧（渐变、光斑、扫描线、文字）；
 *   2. 用 I_PCM 方式的 H.264 编码每帧（浏览器可解码）；
 *   3. 封装成 faststart MP4。
 *
 * 产物是**真正可播放的视频**，只是画面内容是规则合成的仿真画面。
 * 默认 320×176 / 12fps / 2 秒 —— I_PCM 不做压缩，分辨率与时长必须克制，
 * 否则单个文件会膨胀到几十 MB。
 */

const DEFAULT_FPS = 12;
const DEFAULT_SECONDS = 2;
const MAX_LONG_SIDE = 320;

/** 选一个 16 的倍数、且贴合请求宽高比的轻量分辨率。 */
export function pickVideoSize(size, resolution) {
  let ratio = 16 / 9;
  let source = size;
  if (!source && resolution) {
    const r = String(resolution).toLowerCase();
    if (r === '1080p' || r === '720p' || r === '2k' || r === '4k') ratio = 16 / 9;
    else if (r === '480p') ratio = 4 / 3;
  }
  if (typeof source === 'string') {
    const m = /^(\d{2,5})\s*[x×]\s*(\d{2,5})$/i.exec(source.trim());
    if (m) ratio = Number(m[1]) / Number(m[2]);
  }
  const portrait = ratio < 1;
  const long = MAX_LONG_SIDE;
  const short = clamp(Math.round((long * (portrait ? ratio : 1 / ratio)) / 16) * 16, 96, long);
  // 宽高都必须是 16 的倍数
  let width = portrait ? short : long;
  let height = portrait ? long : short;
  width = Math.max(16, Math.round(width / 16) * 16);
  height = Math.max(16, Math.round(height / 16) * 16);
  return { width, height };
}

function drawFrame({ width, height, rng, palette, prompt, model, frameIndex, frameCount, seed }) {
  const canvas = new Raster(width, height, palette.background);
  const t = frameCount <= 1 ? 0 : frameIndex / (frameCount - 1);
  const wave = Math.sin(t * Math.PI * 2);
  const unit = Math.min(width, height);

  // 背景随时间轻微呼吸
  const top = mix(palette.background, palette.backgroundEnd, 0.25 + 0.25 * wave);
  const bottom = mix(palette.backgroundEnd, palette.background, 0.2 + 0.2 * -wave);
  canvas.verticalGradient(top, bottom);

  // 移动光斑
  const glowA = {
    x: width * (0.2 + 0.55 * t),
    y: height * (0.3 + 0.18 * Math.sin(t * Math.PI * 2 + 1)),
  };
  const glowB = {
    x: width * (0.8 - 0.5 * t),
    y: height * (0.7 + 0.12 * Math.cos(t * Math.PI * 2)),
  };
  canvas.radialGlow(glowA.x, glowA.y, unit * 0.65, palette.accent, 0.4);
  canvas.radialGlow(glowB.x, glowB.y, unit * 0.55, palette.highlight, 0.24);

  // 同心环随时间扩张
  const cx = width * 0.5;
  const cy = height * 0.44;
  for (let i = 0; i < 4; i += 1) {
    const phase = (t + i * 0.18) % 1;
    const radius = unit * (0.08 + phase * 0.42);
    canvas.ring(cx, cy, radius, Math.max(1, unit * 0.006), i % 2 ? palette.highlight : palette.accent, 0.55 * (1 - phase));
  }

  // 扫描线
  const scanY = Math.round(t * (height - 1));
  canvas.fillRect(0, scanY, width, Math.max(1, Math.round(unit * 0.005)), palette.highlight, 0.28);
  for (let y = Math.max(0, scanY - 6); y < Math.min(height, scanY + 6); y += 1) {
    canvas.fillRect(0, y, width, 1, palette.highlight, 0.03);
  }

  // 漂浮粒子（位置由种子决定，随时间平移）
  const particles = 18;
  for (let i = 0; i < particles; i += 1) {
    const px = (rng() * width + t * width * (0.2 + rng() * 0.5)) % width;
    const py = rng() * height;
    const r = 1 + rng() * Math.max(1, unit * 0.012);
    canvas.fillCircle(px, py, r, i % 3 === 0 ? palette.highlight : palette.ink, 0.16 + rng() * 0.2);
  }

  // 文字层
  const margin = Math.max(8, Math.round(unit * 0.05));
  const titleScale = Math.max(2, Math.round(unit / 70));
  const smallScale = Math.max(1, Math.round(unit / 130));
  canvas.drawText('MOCK VIDEO', margin, margin, { scale: titleScale, color: palette.accent });
  canvas.drawText(model.toUpperCase().slice(0, 30), margin, margin + titleScale * 10, {
    scale: smallScale,
    color: palette.inkMuted,
  });

  // 提示词摘要
  const excerpt = asciiExcerpt(prompt, 90);
  const textScale = Math.max(1, Math.round(unit / 120));
  const maxW = width - margin * 2;
  const lines = wrapText(excerpt, maxW, textScale).slice(0, 2);
  let ty = height - margin - lines.length * (7 * textScale + 4 * textScale) - Math.round(unit * 0.055);
  for (const line of lines) {
    canvas.drawText(line, margin, ty, { scale: textScale, color: palette.ink, alpha: 0.92 });
    ty += 7 * textScale + 4 * textScale;
  }

  // 进度条 + 帧号
  const barH = Math.max(2, Math.round(unit * 0.012));
  const barY = height - margin - barH;
  canvas.fillRect(margin, barY, width - margin * 2, barH, palette.ink, 0.18);
  canvas.fillRect(margin, barY, Math.max(1, Math.round((width - margin * 2) * (frameIndex + 1) / frameCount)), barH, palette.accent, 0.9);
  const label = `${String(frameIndex + 1).padStart(3, '0')}/${String(frameCount).padStart(3, '0')}`;
  canvas.drawText(label, width - margin - measureText(label, smallScale), barY - 7 * smallScale - 3, {
    scale: smallScale,
    color: palette.inkMuted,
  });

  // 固定画幅角标
  const mark = Math.round(unit * 0.03);
  canvas.fillRect(margin, margin, mark, 2, palette.ink, 0.5);
  canvas.fillRect(margin, margin, 2, mark, palette.ink, 0.5);

  canvas.speckle(rng, Math.round((width * height) / 1600), 0.04);
  return canvas.toRGB();
}

function mix(a, b, t) {
  const k = clamp(t, 0, 1);
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}

/**
 * @param {{
 *   prompt: string,
 *   model: string,
 *   size?: string,
 *   resolution?: string,
 *   seconds?: number,
 *   seed?: number|string,
 *   maxSeconds?: number,
 *   hasFirstFrame?: boolean,
 * }} opts
 */
export function generateVideo(opts) {
  const prompt = String(opts.prompt ?? '').trim();
  const model = String(opts.model ?? 'mock-video');
  const seed = opts.seed ?? 0;
  const seconds = clamp(Number(opts.seconds) || DEFAULT_SECONDS, 1, opts.maxSeconds ?? 6);
  const fps = DEFAULT_FPS;
  const frameCount = Math.max(1, Math.round(seconds * fps));
  const { width, height } = pickVideoSize(opts.size, opts.resolution);

  const digest = sha256hex(`${prompt}|${model}|${seed}|${width}x${height}`);
  const palette = paletteFrom(`${prompt}|${model}|${seed}`);
  // 每帧的粒子在整段视频里保持同一组随机序列，形成连贯的运动
  const frameRng = seededRng(Buffer.from(digest, 'hex'));

  const frames = [];
  for (let i = 0; i < frameCount; i += 1) {
    frames.push(
      drawFrame({
        width,
        height,
        rng: frameRng,
        palette,
        prompt: prompt + (opts.hasFirstFrame ? ' [image-to-video]' : ''),
        model,
        frameIndex: i,
        frameCount,
        seed,
      }),
    );
  }

  const { sps, pps, samples } = encodeAvcFrames(frames, width, height);
  const buffer = buildMp4({ width, height, fps, sps, pps, samples });

  return {
    buffer,
    width,
    height,
    fps,
    frameCount,
    durationSeconds: Number((frameCount / fps).toFixed(2)),
    mime: 'video/mp4',
    ext: 'mp4',
    model,
  };
}
