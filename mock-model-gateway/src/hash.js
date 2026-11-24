import { createHash } from 'node:crypto';

/** SHA-256 → 32 字节 Buffer。所有「仿真随机」都以它为种子。 */
export function sha256(input) {
  return createHash('sha256').update(String(input ?? '')).digest();
}

export function sha256hex(input) {
  return createHash('sha256').update(String(input ?? '')).digest('hex');
}

/**
 * mulberry32 —— 32 位确定性伪随机数。
 *
 * 用相同 prompt + model + seed 永远得到相同画面，便于联调时复现。
 * 这不是密码学随机数，也不需要是。
 */
export function seededRng(seedBuffer) {
  let a = 0;
  for (let i = 0; i < Math.min(seedBuffer.length, 4); i += 1) {
    a = (a * 256 + seedBuffer[i]) >>> 0;
  }
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randInt(rng, min, max) {
  return min + Math.floor(rng() * (max - min + 1));
}

export function pick(rng, list) {
  return list[Math.floor(rng() * list.length) % list.length];
}

export function shuffle(rng, list) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function clamp(v, min, max) {
  return v < min ? min : v > max ? max : v;
}

/** HSL → RGB，h∈[0,360), s/l∈[0,1]，返回 0-255 整数三元组。 */
export function hslToRgb(h, s, l) {
  const hue = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (hue < 60) [r, g, b] = [c, x, 0];
  else if (hue < 120) [r, g, b] = [x, c, 0];
  else if (hue < 180) [r, g, b] = [0, c, x];
  else if (hue < 240) [r, g, b] = [0, x, c];
  else if (hue < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

/** prompt 里点名的颜色 → 色相。命中时优先于哈希，让画面看得出「听懂了 prompt」。 */
const COLOR_WORDS = [
  { hue: 270, words: ['purple', 'violet', 'lavender', '紫'] },
  { hue: 215, words: ['blue', 'navy', 'azure', '蓝'] },
  { hue: 180, words: ['teal', 'cyan', 'turquoise', '青'] },
  { hue: 140, words: ['green', 'emerald', '绿'] },
  { hue: 50, words: ['yellow', 'gold', 'golden', '黄', '金'] },
  { hue: 25, words: ['orange', 'amber', '橙', '橘'] },
  { hue: 0, words: ['red', 'crimson', '红'] },
  { hue: 330, words: ['pink', 'magenta', 'rose', '粉', '玫瑰'] },
  { hue: 30, words: ['brown', 'wooden', 'wood', '棕', '木'] },
];

function hueFromPrompt(prompt) {
  const text = String(prompt ?? '').toLowerCase();
  for (const entry of COLOR_WORDS) {
    for (const word of entry.words) {
      // 英文按单词边界匹配，避免 "purple" 命中 "purpleness" 之外的误伤；
      // 中文没有空格，用 includes 即可。
      const hit = /^[a-z]+$/.test(word)
        ? new RegExp(`\\b${word}\\b`).test(text)
        : text.includes(word);
      if (hit) return entry.hue;
    }
  }
  return null;
}

/**
 * 由 prompt 派生一套配色。
 *
 * prompt 里点名了颜色就以它为主色；否则用哈希前两字节，保证每个
 * prompt 有稳定但不同的主色。再取互补色 / 邻近色作为点缀，避免
 * 「同一张图换个字」的重复感。
 */
export function paletteFrom(prompt) {
  const h = sha256(prompt);
  const namedHue = hueFromPrompt(prompt);
  const baseHue = namedHue === null ? (h[0] * 256 + h[1]) % 360 : namedHue;
  // 用邻近色而不是补色：补色（相差 140° 以上）落在画面上容易喧宾夺主，
  // 邻近色更像真实生成图里「同色系打光」的观感。
  const accentHue = (baseHue + 30 + (h[2] % 40)) % 360;
  const deepHue = (baseHue + 28) % 360;
  return {
    baseHue,
    accentHue,
    background: hslToRgb(baseHue, 0.42, 0.16),
    backgroundEnd: hslToRgb(deepHue, 0.5, 0.06),
    accent: hslToRgb(accentHue, 0.72, 0.58),
    accentSoft: hslToRgb(accentHue, 0.55, 0.34),
    highlight: hslToRgb((baseHue - 50 + 360) % 360, 0.7, 0.7),
    ink: [244, 246, 252],
    inkMuted: [176, 184, 204],
    panel: hslToRgb(baseHue, 0.28, 0.1),
  };
}
