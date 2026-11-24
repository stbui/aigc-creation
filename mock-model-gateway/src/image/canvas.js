import { GLYPH_HEIGHT, GLYPH_WIDTH, GLYPH_GAP, glyphOf, measureText } from './font.js';

/**
 * 极简 RGB 光栅画布。
 *
 * 只实现生成仿真图真正需要的操作：填充、渐变、圆、线、文字、噪点。
 * 全部按 alpha 混合写进一个 Uint8ClampedArray，最后交给 PNG 编码器。
 */
export class Raster {
  constructor(width, height, background = [10, 12, 20]) {
    this.width = width;
    this.height = height;
    this.data = new Uint8ClampedArray(width * height * 3);
    this.fill(background);
  }

  fill([r, g, b]) {
    for (let i = 0; i < this.data.length; i += 3) {
      this.data[i] = r;
      this.data[i + 1] = g;
      this.data[i + 2] = b;
    }
  }

  setPixel(x, y, [r, g, b], alpha = 1) {
    const xi = x | 0;
    const yi = y | 0;
    if (xi < 0 || yi < 0 || xi >= this.width || yi >= this.height) return;
    const i = (yi * this.width + xi) * 3;
    if (alpha >= 1) {
      this.data[i] = r;
      this.data[i + 1] = g;
      this.data[i + 2] = b;
      return;
    }
    const a = Math.max(0, Math.min(1, alpha));
    this.data[i] = this.data[i] * (1 - a) + r * a;
    this.data[i + 1] = this.data[i + 1] * (1 - a) + g * a;
    this.data[i + 2] = this.data[i + 2] * (1 - a) + b * a;
  }

  fillRect(x, y, w, h, color, alpha = 1) {
    const x0 = Math.max(0, Math.floor(x));
    const y0 = Math.max(0, Math.floor(y));
    const x1 = Math.min(this.width, Math.ceil(x + w));
    const y1 = Math.min(this.height, Math.ceil(y + h));
    for (let yy = y0; yy < y1; yy += 1) {
      for (let xx = x0; xx < x1; xx += 1) {
        this.setPixel(xx, yy, color, alpha);
      }
    }
  }

  fillCircle(cx, cy, radius, color, alpha = 1) {
    const r2 = radius * radius;
    const x0 = Math.max(0, Math.floor(cx - radius));
    const y0 = Math.max(0, Math.floor(cy - radius));
    const x1 = Math.min(this.width, Math.ceil(cx + radius));
    const y1 = Math.min(this.height, Math.ceil(cy + radius));
    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        if (dx * dx + dy * dy <= r2) this.setPixel(x, y, color, alpha);
      }
    }
  }

  /** 圆环（只画 [r-thickness, r] 这一圈）。 */
  ring(cx, cy, radius, thickness, color, alpha = 1) {
    const outer = radius;
    const inner = Math.max(0, radius - thickness);
    const o2 = outer * outer;
    const i2 = inner * inner;
    const x0 = Math.max(0, Math.floor(cx - outer));
    const y0 = Math.max(0, Math.floor(cy - outer));
    const x1 = Math.min(this.width, Math.ceil(cx + outer));
    const y1 = Math.min(this.height, Math.ceil(cy + outer));
    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        const d2 = dx * dx + dy * dy;
        if (d2 <= o2 && d2 >= i2) this.setPixel(x, y, color, alpha);
      }
    }
  }

  strokeRect(x, y, w, h, color, thickness = 1, alpha = 1) {
    this.fillRect(x, y, w, thickness, color, alpha);
    this.fillRect(x, y + h - thickness, w, thickness, color, alpha);
    this.fillRect(x, y, thickness, h, color, alpha);
    this.fillRect(x + w - thickness, y, thickness, h, color, alpha);
  }

  roundRect(x, y, w, h, radius, color, alpha = 1) {
    const r = Math.min(radius, w / 2, h / 2);
    this.fillRect(x + r, y, w - 2 * r, h, color, alpha);
    this.fillRect(x, y + r, w, h - 2 * r, color, alpha);
    this.fillCircle(x + r, y + r, r, color, alpha);
    this.fillCircle(x + w - r, y + r, r, color, alpha);
    this.fillCircle(x + r, y + h - r, r, color, alpha);
    this.fillCircle(x + w - r, y + h - r, r, color, alpha);
  }

  /** 竖向线性渐变，铺满整张画布。 */
  verticalGradient(top, bottom) {
    for (let y = 0; y < this.height; y += 1) {
      const t = this.height <= 1 ? 0 : y / (this.height - 1);
      const color = [
        top[0] + (bottom[0] - top[0]) * t,
        top[1] + (bottom[1] - top[1]) * t,
        top[2] + (bottom[2] - top[2]) * t,
      ];
      for (let x = 0; x < this.width; x += 1) {
        const i = (y * this.width + x) * 3;
        this.data[i] = color[0];
        this.data[i + 1] = color[1];
        this.data[i + 2] = color[2];
      }
    }
  }

  /** 以 (cx,cy) 为中心的径向光晕，边缘线性衰减到 0。 */
  radialGlow(cx, cy, radius, color, maxAlpha = 0.5) {
    const x0 = Math.max(0, Math.floor(cx - radius));
    const y0 = Math.max(0, Math.floor(cy - radius));
    const x1 = Math.min(this.width, Math.ceil(cx + radius));
    const y1 = Math.min(this.height, Math.ceil(cy + radius));
    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        const dx = (x - cx) / radius;
        const dy = (y - cy) / radius;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d >= 1) continue;
        const a = (1 - d) * (1 - d) * maxAlpha;
        this.setPixel(x, y, color, a);
      }
    }
  }

  drawLine(x0, y0, x1, y1, color, thickness = 1, alpha = 1) {
    /*
     * ⚠️ 必须先把端点取整，再用取整后的差值跑 Bresenham。
     *
     * 曾经踩过的坑：用未取整的 dx/dy 配取整后的 x/y，会在某些斜率下
     * 让某一轴先越过终点，而循环的退出条件是 x===tx && y===ty ——
     * 越过后永远不相等，drawLine 变成死循环（表现为生成图片时 CPU 100%）。
     * 另外加 guard 兜底：宁可少画一格，也不能挂死进程。
     */
    let x = Math.round(x0);
    let y = Math.round(y0);
    const tx = Math.round(x1);
    const ty = Math.round(y1);
    const dx = Math.abs(tx - x);
    const dy = Math.abs(ty - y);
    const sx = x < tx ? 1 : -1;
    const sy = y < ty ? 1 : -1;
    let err = dx - dy;
    let guard = dx + dy + 2;
    // Bresenham 只给出 1px 骨架，厚度用正方形笔刷补
    const half = Math.max(0, Math.floor((thickness - 1) / 2));
    while (guard > 0) {
      guard -= 1;
      if (half === 0) this.setPixel(x, y, color, alpha);
      else this.fillRect(x - half, y - half, thickness, thickness, color, alpha);
      if (x === tx && y === ty) break;
      const e2 = 2 * err;
      if (e2 > -dy) {
        err -= dy;
        x += sx;
      }
      if (e2 < dx) {
        err += dx;
        y += sy;
      }
    }
  }

  /**
   * 画点阵文字。
   * @returns {{ width: number, height: number }}
   */
  drawText(text, x, y, opts = {}) {
    const scale = opts.scale ?? 2;
    const tracking = opts.tracking ?? GLYPH_GAP;
    const color = opts.color ?? [255, 255, 255];
    const alpha = opts.alpha ?? 1;
    const chars = [...String(text ?? '')];
    let cursor = x;
    for (const ch of chars) {
      const glyph = glyphOf(ch);
      for (let row = 0; row < GLYPH_HEIGHT; row += 1) {
        const bits = glyph[row];
        for (let col = 0; col < GLYPH_WIDTH; col += 1) {
          if (bits[col] !== '1') continue;
          this.fillRect(
            cursor + col * scale,
            y + row * scale,
            scale,
            scale,
            color,
            alpha,
          );
        }
      }
      cursor += (GLYPH_WIDTH + tracking) * scale;
    }
    return { width: (cursor - x) || 0, height: GLYPH_HEIGHT * scale };
  }

  /** 居中绘制单行文字，返回实际绘制宽度。 */
  drawTextCentered(text, cx, y, opts = {}) {
    const scale = opts.scale ?? 2;
    const tracking = opts.tracking ?? GLYPH_GAP;
    const width = measureText(text, scale, tracking);
    this.drawText(text, Math.round(cx - width / 2), y, opts);
    return width;
  }

  /** 撒噪点 —— 让渐变看起来有胶片颗粒，避免大片纯色被误判成缩略图加载失败。 */
  speckle(rng, count, alpha = 0.05) {
    for (let i = 0; i < count; i += 1) {
      const x = Math.floor(rng() * this.width);
      const y = Math.floor(rng() * this.height);
      const v = rng() > 0.5 ? 255 : 0;
      this.setPixel(x, y, [v, v, v], alpha);
    }
  }

  toRGB() {
    return Buffer.from(this.data.buffer, this.data.byteOffset, this.data.byteLength);
  }
}
