import { join } from 'path';
import { Jimp, loadFont, JimpMime, rgbaToInt } from 'jimp';

/**
 * jimp 1.x 的实例类型是泛型化的 (JimpInstanceMethods<Bitmap, ...>), read()/cover()/rotate()
 * 各方法返回的具体泛型实参不同, 跨调用点传递时 TS 无法收敛成同一类型。下面这些辅助函数
 * 只用到 bitmap / composite / print / getBuffer / clone / blur 这几个成员, 故用宽松别名,
 * 避免为了类型体操去写大量 as 断言。
 */
type Img = any;
import { ImageProvider, ImageProviderResult } from './image-provider.interface';
import { getCapability, sanitizeParams, parseDetailSections } from '../capabilities/capability.registry';

/**
 * 本地 Provider。
 *
 * real 能力用 Jimp 真实算法产出可见差异 (主图 / 详情图 / 抠图 / 扩图 / 换色 / 旋转 / 精修);
 * mock 能力本质依赖真实 AI 模型 (爆款复刻 / 创意生图 / 局部重绘 / 去水印 / 图片翻译),
 * 这里生成"参数化占位图" —— 每项给不同的视觉处理并在图上标注 (MOCK), 保证一眼可区分,
 * 绝不用假效果冒充模型能力。真实能力接入方式: 另实现一个 ImageProvider 替换
 * providers.module.ts 的 IMAGE_PROVIDER 绑定即可, 业务层无感。
 *
 * 注: Jimp 内置字体仅含 ASCII, 图内文案一律英文; 中文只出现在界面层。
 */

// ───────────────── 字体 ─────────────────

function resolveFontPath(color: 'white' | 'black', px: 32 | 64): string {
  const pkgJson = require.resolve('@jimp/plugin-print/package.json');
  return join(
    pkgJson.replace(/package\.json$/, ''),
    `dist/fonts/open-sans/open-sans-${px}-${color}/open-sans-${px}-${color}.fnt`,
  );
}

const fontCache = new Map<string, Promise<any>>();
function loadCachedFont(color: 'white' | 'black' = 'white', px: 32 | 64 = 32): Promise<any> {
  const key = `${color}-${px}`;
  let p = fontCache.get(key);
  if (!p) {
    p = loadFont(resolveFontPath(color, px));
    fontCache.set(key, p);
  }
  return p;
}

// ───────────────── 通用工具 ─────────────────

function requireInput(inputPaths: string[], capability: string): string {
  const p = inputPaths.find(Boolean);
  if (!p) throw new Error(`${capability} 需要至少一张输入图`);
  return p;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!m) return { r: 0x25, g: 0x63, b: 0xeb };
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
}

/** 只保留可打印 ASCII, 供图内文字使用 (Jimp 字体无中文字形) */
function asciiOnly(text: string, maxLen = 48): string {
  const cleaned = String(text ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[^\x20-\x7E]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.length > maxLen ? cleaned.slice(0, maxLen) : cleaned;
}

async function printText(
  img: Img,
  text: string,
  x: number,
  y: number,
  color: 'white' | 'black' = 'white',
): Promise<void> {
  const t = asciiOnly(text);
  if (!t) return;
  try {
    // 字号随画布尺寸缩放: 32px 字体在 1024+ 画布上太小, 2048 画布用 64px
    const px: 32 | 64 = img.bitmap.width >= 1600 ? 64 : 32;
    // 防止大字号文本越界被裁切
    const maxY = img.bitmap.height - px - 8;
    const font = await loadCachedFont(color, px);
    img.print({ font, x, y: Math.max(0, Math.min(y, maxY)), text: t });
  } catch {
    /* 字体加载失败时跳过文字, 不影响图片产出 */
  }
}

/** 底部实心信息条 (宽度自适应内容) */
async function drawFooterBar(img: Img, text: string, bg = 0x111827ff): Promise<void> {
  // 条高随字号: 1K 画布 32px 字体 (44px 条), 2K 画布 64px 字体 (88px 条), 避免文字被裁切
  const fontPx = img.bitmap.width >= 1600 ? 64 : 32;
  const barH = fontPx === 64 ? 88 : 44;
  const y = img.bitmap.height - barH;
  if (y < 0) return;
  const bar = new Jimp({ width: img.bitmap.width, height: barH, color: bg });
  img.composite(bar, 0, y);
  await printText(img, text, 12, y + Math.round((barH - fontPx) / 2));
}

/** 纵向渐变画布 (top→bottom 线性插值) */
function makeVerticalGradient(w: number, h: number, top: number[], bottom: number[]): Img {
  const img = new Jimp({ width: w, height: h, color: 0xffffffff });
  for (let y = 0; y < h; y++) {
    const t = h <= 1 ? 0 : y / (h - 1);
    const r = Math.round(top[0] + (bottom[0] - top[0]) * t);
    const g = Math.round(top[1] + (bottom[1] - top[1]) * t);
    const b = Math.round(top[2] + (bottom[2] - top[2]) * t);
    const color = rgbaToInt(r, g, b, 255);
    for (let x = 0; x < w; x++) img.setPixelColor(color, x, y);
  }
  return img;
}

/** 半透明实心椭圆 (用于场景图投影; color 需带 alpha, 如 0x1e293b66) */
function drawEllipse(img: Img, cx: number, cy: number, rx: number, ry: number, color: number): void {
  if (rx <= 0 || ry <= 0) return;
  const x0 = Math.max(0, Math.round(cx - rx));
  const x1 = Math.min(img.bitmap.width - 1, Math.round(cx + rx));
  const y0 = Math.max(0, Math.round(cy - ry));
  const y1 = Math.min(img.bitmap.height - 1, Math.round(cy + ry));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = (x - cx) / rx;
      const dy = (y - cy) / ry;
      if (dx * dx + dy * dy <= 1) img.setPixelColor(color, x, y);
    }
  }
}

function parseRatio(ratio: string, fallback = 1): number {
  const m = /^(\d+)\s*[:x/]\s*(\d+)$/.exec(String(ratio ?? ''));
  if (!m) return fallback;
  const w = Number(m[1]);
  const h = Number(m[2]);
  if (!w || !h) return fallback;
  return h / w;
}

// ───────────────── 爆款复刻辅助 ─────────────────

/** 越界安全的 setPixelColor (绘制边框/缩略图时免去四处夹取) */
function safeSetPixel(img: Img, color: number, x: number, y: number): void {
  const xi = Math.round(x);
  const yi = Math.round(y);
  if (xi < 0 || yi < 0 || xi >= img.bitmap.width || yi >= img.bitmap.height) return;
  img.setPixelColor(color, xi, yi);
}

/**
 * 测量 ASCII 文本像素宽度 (jimp 1.x 的 font 对象无 measureText,
 * 按 chars 表逐字累加 xadvance; 用于标注浮层排版, 防止文字溢出画布被裁)
 */
async function measureTextWidth(text: string, fontPx: 32 | 64): Promise<number> {
  const font = await loadCachedFont('white', fontPx);
  let w = 0;
  for (const ch of asciiOnly(text, 200)) {
    const c = font.chars?.[ch];
    if (c && typeof c.xadvance === 'number') w += c.xadvance;
  }
  return w;
}

/**
 * 参考图布局签名: cover 到 GRID×GRID 后取每格平均色 (int 格式 r<<24|g<<16|b<<8|a)。
 * 这是参考图真实参与生成的载体 —— 复刻程度两档都基于它, 而不是写死的配色。
 */
function extractLayoutSignature(img: Img, grid: number): number[] {
  const small = img.clone().cover({ w: grid, h: grid });
  const { data } = small.bitmap;
  const out: number[] = [];
  for (let i = 0; i < grid * grid; i++) {
    const o = i * 4;
    out.push(rgbaToInt(data[o], data[o + 1], data[o + 2], 255));
  }
  return out;
}

function intLuma(c: number): number {
  const r = (c >>> 24) & 255;
  const g = (c >>> 16) & 255;
  const b = (c >>> 8) & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/** ASCII 文本按词断行 (图内多行排版; printText 单行不换行) */
function wrapAsciiText(text: string, maxChars: number): string[] {
  const words = String(text ?? '').split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if (!cur) cur = w;
    else if ((cur + ' ' + w).length <= maxChars) cur += ' ' + w;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

/** 布局签名 → 调色板: 按亮度排序后均匀采样 n 色 (真实来自参考图) */
function layoutPalette(sig: number[], n: number): number[] {
  const sorted = [...sig].sort((a, b) => intLuma(a) - intLuma(b));
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    out.push(sorted[Math.min(sorted.length - 1, Math.round((i * (sorted.length - 1)) / Math.max(1, n - 1)))]);
  }
  return out;
}

/**
 * 用布局签名重建场景: GRID×GRID 色块阵双线性放大到目标尺寸。
 * 参考图的明暗结构与配色被保留, 但像素细节被"重构" —— 即参考站的"参考风格"档语义。
 */
async function buildSceneFromLayout(sig: number[], grid: number, W: number, H: number): Promise<Img> {
  const small = new Jimp({ width: grid, height: grid, color: 0xffffffff });
  for (let i = 0; i < sig.length; i++) {
    small.setPixelColor(sig[i], i % grid, Math.floor(i / grid));
  }
  return small.clone().resize({ w: W, h: H, mode: 'bilinearInterpolation' });
}

/** 整体压暗 (逐通道乘以 factor), 让叠加的卡位/描边更突出 */
function dimImage(img: Img, factor: number): void {
  const { data } = img.bitmap;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    data[i] = clampInt(Math.round(data[i] * factor), 0, 255);
    data[i + 1] = clampInt(Math.round(data[i + 1] * factor), 0, 255);
    data[i + 2] = clampInt(Math.round(data[i + 2] * factor), 0, 255);
  }
}

/** 矩形描边 (宽度 t, 越界自动裁剪) */
function drawRectBorder(img: Img, x: number, y: number, w: number, h: number, t: number, color: number): void {
  for (let i = 0; i < t; i++) {
    for (let xx = x; xx < x + w; xx++) {
      safeSetPixel(img, color, xx, y + i);
      safeSetPixel(img, color, xx, y + h - 1 - i);
    }
    for (let yy = y; yy < y + h; yy++) {
      safeSetPixel(img, color, x + i, yy);
      safeSetPixel(img, color, x + w - 1 - i, yy);
    }
  }
}

/** 参考图细节标注 1: 布局缩略图 (右上, GRID×GRID 真实色块 + 半透明底衬) */
async function drawLayoutThumb(img: Img, sig: number[], grid: number): Promise<void> {
  const fontPx = img.bitmap.width >= 1600 ? 64 : 32;
  const cell = Math.max(4, Math.round(img.bitmap.width / 128));
  const thumbW = cell * grid;
  const pad = Math.round(img.bitmap.width / 64);
  const label = 'REF LAYOUT';
  const textW = await measureTextWidth(label, fontPx);
  const bgW = Math.min(img.bitmap.width - pad * 2, Math.max(thumbW, textW) + pad * 2);
  const x0 = img.bitmap.width - bgW - pad;
  const y0 = pad;
  const bg = new Jimp({
    width: bgW,
    height: thumbW + pad * 2 + fontPx + 8,
    color: 0x0f172acc,
  });
  img.composite(bg, x0, y0);
  // 文字右对齐底衬右缘, 缩略图左对齐, 均不溢出画布
  await printText(img, label, Math.max(x0 + pad, x0 + bgW - pad - textW), y0 + pad, 'white');
  for (let i = 0; i < sig.length; i++) {
    const cx = i % grid;
    const cy = Math.floor(i / grid);
    const tile = new Jimp({ width: cell, height: cell, color: sig[i] });
    img.composite(tile, x0 + pad + cx * cell, y0 + pad + fontPx + 8 + cy * cell);
  }
}

/** 参考图细节标注 2: 调色板色卡 (左上, 5 色真实提取 + 半透明底衬) */
async function drawPaletteChips(img: Img, palette: number[]): Promise<void> {
  const fontPx = img.bitmap.width >= 1600 ? 64 : 32;
  const chip = Math.max(16, Math.round(img.bitmap.width / 32));
  const gap = Math.max(4, Math.round(chip / 5));
  const pad = Math.round(img.bitmap.width / 64);
  const label = 'REF PALETTE';
  const textW = await measureTextWidth(label, fontPx);
  const rowW = palette.length * chip + (palette.length - 1) * gap;
  const bgW = Math.min(img.bitmap.width - pad * 2, Math.max(rowW, textW) + pad * 2);
  const x0 = pad;
  const y0 = pad;
  const bg = new Jimp({
    width: bgW,
    height: chip + pad * 2 + fontPx + 8,
    color: 0x0f172acc,
  });
  img.composite(bg, x0, y0);
  await printText(img, label, x0 + pad, y0 + pad, 'white');
  for (let i = 0; i < palette.length; i++) {
    const swatch = new Jimp({ width: chip, height: chip, color: palette[i] });
    img.composite(swatch, x0 + pad + i * (chip + gap), y0 + pad + fontPx + 8);
  }
}

/** 底部信息带: 多行白字 + 深色半透明底 (坐在 footer 条上方, 行高随字号) */
async function drawCloneCaption(img: Img, lines: string[]): Promise<void> {
  const fontPx = img.bitmap.width >= 1600 ? 64 : 32;
  const lineH = fontPx + 12;
  const pad = 10;
  const footerH = fontPx === 64 ? 88 : 44;
  const bandH = lines.length * lineH + pad * 2;
  const y0 = img.bitmap.height - footerH - bandH;
  if (y0 < 0) return;
  const band = new Jimp({ width: img.bitmap.width, height: bandH, color: 0x0f172ad9 });
  img.composite(band, 0, y0);
  let ty = y0 + pad;
  for (const line of lines) {
    await printText(img, line, Math.round(img.bitmap.width / 64), ty, 'white');
    ty += lineH;
  }
}

// ───────────────── Provider ─────────────────

export class MockImageProvider implements ImageProvider {
  async generate(
    capability: string,
    inputPaths: string[],
    rawParams: Record<string, any>,
  ): Promise<ImageProviderResult> {
    const def = getCapability(capability);
    if (!def) throw new Error(`unsupported capability: ${capability}`);
    if (def.mode === 'planned') {
      throw new Error(`${def.name} 尚未开放`);
    }
    const params = sanitizeParams(capability, rawParams);

    /*
     * 分派: 按能力声明的 localImpl 句柄取实现 (2026-10-20 抽离)。
     *
     * 改造前这里是 14 个 case 的 switch, 与能力注册表平行维护。漏加 case 时
     * 落到 `default: throw`, 症状是该能力在远程通道失败后**没有本地兜底** ——
     * 用户拿不到任何产出, 且错误信息只有一句 "unsupported capability"。
     *
     * 现在映射关系由各能力的定义文件声明 (`localImpl` 字段), 本类只负责
     * 「按名字取自己的方法」。新增能力无需碰这个类。
     */
    const impl = this.resolveLocalImpl(def.localImpl, capability);
    // makePlaceholder 需要 capability 来决定画哪种占位图, 其余实现只收参数
    return impl === 'makePlaceholder'
      ? this.makePlaceholder(capability, inputPaths, params)
      : (this as unknown as Record<string, (a: string[], p: Record<string, any>) => Promise<ImageProviderResult>>)[
          impl
        ](inputPaths, params);
  }

  /**
   * 把句柄名解析成真正的实现函数, 并在装配期语义之外再加一道运行时校验。
   *
   * 双保险的原因: 能力定义里的 localImpl 是个**字符串**, 类型系统无法保证
   * 它真对应本类上的某个方法 (比如写错字、或删了方法忘了改能力定义)。
   * 装配期的 assertCapabilityIntegrity 只校验"声明了非空", 不校验"方法存在" ——
   * 因为它在 capabilities 模块里, 不该反向依赖 providers。
   * 故此处显式查表 + 抛错, 把"句柄与实现脱节"变成可读的错误而非 undefined 调用。
   */
  private resolveLocalImpl(key: string | undefined, capability: string) {
    if (!key) {
      throw new Error(
        `能力 ${capability} 未声明 localImpl —— 图像能力必须有本地兜底实现` +
          `（该断言也应在装配期触发, 走到这里说明能力定义有问题）`,
      );
    }
    const fn = (this as unknown as Record<string, unknown>)[key];
    if (typeof fn !== 'function') {
      throw new Error(
        `能力 ${capability} 的 localImpl "${key}" 在 MockImageProvider 上没有对应方法 —— ` +
          `请检查该能力定义文件与本类的方法名是否一致`,
      );
    }
    return key;
  }

  // ── real: 商品主图 (参考站 product-kit: 按变体计数批量生成, 每张可见差异) ──
  private async makeMainImage(inputPaths: string[], params: Record<string, any>) {
    const inputPath = requireInput(inputPaths, 'main_image');
    // 画质枚举 1k/2k → 输出边长 (参考站高级设置"分辨率")
    const size = params.size === '2k' ? 2048 : 1024;
    const ratioH = parseRatio(params.ratio, 1); // 高 / 宽
    const W = size;
    const H = Math.max(64, Math.round(size * ratioH));

    const platform = String(params.platform ?? 'taobao');
    const name = asciiOnly(params.productName, 40);
    const brand = asciiOnly(params.brand, 24);
    const desc = asciiOnly(params.description, 60);
    const variant = String(params.variant ?? 'other');

    // 商品主体: 四类变体共用同一张 cover 裁剪, 差异全部来自背景与文案排版
    const product = (await Jimp.read(inputPath)).cover({ w: W, h: H });
    const tag = [brand, name].filter(Boolean).join(' | ') || platform.toUpperCase();

    let img: Img;
    if (variant === 'white_background') {
      img = await this.composeWhiteBackground(product, W, H);
      await printText(img, `${tag} - ${W}x${H}`, 16, H - 40, 'black');
    } else if (variant === 'scene') {
      img = await this.composeScene(product, W, H);
      // 渐变底为浅色, 用黑字保证可读
      await printText(img, `SCENE - ${tag}`, 16, H - 40, 'black');
    } else if (variant === 'selling_point') {
      img = await this.composeSellingBanner(product, W, H);
      const bannerH = Math.round(H * 0.22);
      await printText(img, desc ? `SELLING: ${desc}` : `SELLING POINT - ${tag}`, 16, H - bannerH + 18);
      await printText(img, platform.toUpperCase(), 16, H - bannerH + 58);
    } else {
      img = product.clone();
      const bannerH = Math.round(H * 0.18);
      const banner = new Jimp({ width: W, height: bannerH, color: 0x00000000 });
      for (let y = 0; y < bannerH; y++) {
        const alpha = Math.round(255 * (1 - y / bannerH));
        const color = rgbaToInt(0x25, 0x63, 0xeb, alpha);
        for (let x = 0; x < W; x++) banner.setPixelColor(color, x, y);
      }
      img.composite(banner, 0, H - bannerH);
      await printText(img, `AI MAIN IMAGE - ${tag}`, 16, H - bannerH + Math.round(bannerH / 2) - 16);
    }

    return { kind: 'image' as const, buffer: await img.getBuffer(JimpMime.jpeg), format: 'image/jpeg' };
  }

  /** 白底图: 纯白画布 + 居中商品 + 留白 (电商平台主图规范) */
  private async composeWhiteBackground(product: Img, W: number, H: number): Promise<Img> {
    const img = new Jimp({ width: W, height: H, color: 0xffffffff });
    const pad = Math.round(Math.min(W, H) * 0.08);
    const box = Math.max(16, Math.min(W, H) - pad * 2);
    const cut = product.clone().cover({ w: box, h: box });
    img.composite(cut, Math.round((W - box) / 2), Math.round((H - box) / 2));
    return img;
  }

  /** 场景图: 纵向渐变背景 + 居中商品 + 底部柔和投影 */
  private async composeScene(product: Img, W: number, H: number): Promise<Img> {
    const img = makeVerticalGradient(W, H, [0xEE, 0xF2, 0xFF], [0xC7, 0xD2, 0xFE]);
    const box = Math.round(Math.min(W, H) * 0.72);
    const cut = product.clone().cover({ w: box, h: box });
    const x = Math.round((W - box) / 2);
    const y = Math.round((H - box) / 2) - Math.round(H * 0.04);
    img.composite(cut, x, y);
    // 投影: 商品下方的半透明椭圆, 增强落地感
    drawEllipse(img, W / 2, y + box + Math.round(H * 0.03), box * 0.42, Math.round(H * 0.022), 0x1e293b66);
    return img;
  }

  /** 卖点图: 商品 + 底部深色渐变横幅 (卖点文案由调用方打印) */
  private async composeSellingBanner(product: Img, W: number, H: number): Promise<Img> {
    const img = product.clone();
    const bannerH = Math.round(H * 0.22);
    const banner = new Jimp({ width: W, height: bannerH, color: 0x00000000 });
    for (let y = 0; y < bannerH; y++) {
      const alpha = Math.round(235 * (1 - y / bannerH));
      const color = rgbaToInt(0x1f, 0x29, 0x37, alpha);
      for (let x = 0; x < W; x++) banner.setPixelColor(color, x, y);
    }
    img.composite(banner, 0, H - bannerH);
    return img;
  }

  // ── real: 商品详情图 (参考站 product-detail: 按"包含模块"选择渲染长图区块) ──
  private async makeDetailImage(inputPaths: string[], params: Record<string, any>) {
    const width = params.size === '2k' ? 2048 : 1024;
    const sections = parseDetailSections(params.sections);
    // 详情页长图: 宽高比约 1:3 (与原实现 800x2400 一致)
    const height = Math.max(width, Math.round(width * 3));
    const canvas = new Jimp({ width, height, color: 0xffffffff });

    const name = asciiOnly(params.productName, 40);
    const brand = asciiOnly(params.brand, 24);
    const desc = asciiOnly(params.description, 60);
    const sku = asciiOnly(params.sku, 24);
    const inputPath = inputPaths.find(Boolean);
    const product = inputPath ? await Jimp.read(inputPath) : null;

    const blockH = Math.floor(height / sections.length);
    const barH = Math.max(44, Math.round(width * 0.055));

    for (let i = 0; i < sections.length; i++) {
      const key = sections[i];
      const y0 = i * blockH;
      // 区块头: 交替紫深/浅, 已选模块的顺序与数量直接可见
      const bar = new Jimp({
        width,
        height: barH,
        color: i % 2 === 0 ? 0x625df5ff : 0x9358efff,
      });
      canvas.composite(bar, 0, y0);
      await printText(canvas, `SECTION ${i + 1}/${sections.length}: ${key.replace(/_/g, ' ').toUpperCase()}`, Math.round(width * 0.024), y0 + Math.round(barH * 0.28));

      if (!product) continue;
      const contentTop = y0 + barH + Math.round(width * 0.03);
      const contentH = blockH - barH - Math.round(width * 0.06);
      if (contentH <= 0) continue;

      if (key === 'hero') {
        // 首屏主视觉: 商品大图 + 名称/品牌
        const box = Math.max(64, Math.min(contentH, width - Math.round(width * 0.12)));
        const cut = product.clone().cover({ w: box, h: box });
        canvas.composite(cut, Math.round((width - box) / 2), contentTop);
        const line = [brand, name].filter(Boolean).join(' | ');
        if (line) {
          await printText(canvas, line, Math.round(width * 0.024), y0 + blockH - Math.round(width * 0.07));
        }
      } else {
        // 其余模块: 左文右图 (描述/规格类模块文案行不同, 选择不同模块产出不同版面)
        const imgBox = Math.max(48, Math.min(contentH, Math.round(contentH * 0.9)));
        const cut = product.clone().cover({ w: imgBox, h: imgBox });
        const ix = width - imgBox - Math.round(width * 0.06);
        canvas.composite(cut, ix, contentTop + Math.round((contentH - imgBox) / 2));
        const lines: string[] = [`MODULE: ${key.replace(/_/g, ' ').toUpperCase()}`];
        if (key === 'spec_table' && sku) lines.push(`SKU: ${sku}`);
        if (key === 'selling_points' && desc) lines.push(desc);
        if (key === 'after_sale') lines.push('WARRANTY & RETURN POLICY');
        if (key === 'usage_tips') lines.push('USAGE NOTES');
        if (name && lines.length < 3) lines.push(name);
        let ty = contentTop + Math.round(contentH * 0.18);
        for (const line of lines.slice(0, 3)) {
          await printText(canvas, line, Math.round(width * 0.06), ty, 'black');
          ty += Math.round(width * 0.075);
        }
      }
    }

    return { kind: 'image' as const, buffer: await canvas.getBuffer(JimpMime.jpeg), format: 'image/jpeg' };
  }

  // ── mock: 爆款复刻 (参考站 viral-clone: 商品图 + 参考图, 两档复刻程度) ──
  private async makeClone(inputPaths: string[], params: Record<string, any>) {
    // 输入顺序: [0]=商品图, [1]=参考图 (前端按"上传商品图 / 上传参考图"顺序提交,
    // generate.service.processTask 已按 inputAssetIds 原序保序产出 inputPaths)
    const productPath = requireInput(inputPaths, 'hot_remake');
    const referencePath = inputPaths[1];
    const productSrc = await Jimp.read(productPath);
    const referenceSrc = referencePath ? await Jimp.read(referencePath) : productSrc;

    // 画质枚举 1k/2k → 输出边长; 比例 → 高宽比
    const size = params.size === '2k' ? 2048 : 1024;
    const ratioH = parseRatio(params.ratio, 1);
    const W = size;
    const H = Math.max(64, Math.round(size * ratioH));

    const degree =
      String(params.degree ?? 'high_replica') === 'reference_style' ? 'reference_style' : 'high_replica';
    const requirement = asciiOnly(params.requirement, 72);
    const name = asciiOnly(params.productName, 40);
    const brand = asciiOnly(params.brand, 24);
    const platform = String(params.platform ?? 'taobao');
    const tag = [brand, name].filter(Boolean).join(' | ') || platform.toUpperCase();

    // 参考图真实参与: 提取 GRID×GRID 布局签名 (每格平均色), 两档复刻都以它为依据
    const GRID = 8;
    const layout = extractLayoutSignature(referenceSrc, GRID);
    const palette = layoutPalette(layout, 5);

    let img: Img;
    if (degree === 'reference_style') {
      // 参考风格: 不复制参考图像素, 用布局签名重建场景 ("自动调整色彩和重构场景"),
      // 商品放大居中为主, 落地投影增强真实感
      img = await buildSceneFromLayout(layout, GRID, W, H);
      const box = Math.round(Math.min(W, H) * 0.62);
      const cut = productSrc.clone().cover({ w: box, h: box });
      const x = Math.round((W - box) / 2);
      const y = Math.round((H - box) / 2);
      drawEllipse(img, W / 2, y + box + Math.round(H * 0.02), box * 0.4, Math.round(H * 0.018), 0x0f172a55);
      img.composite(cut, x, y);
    } else {
      // 高度复刻: 参考图整体为底 (视觉结构保留), 商品嵌入中心卡位 + 细边框,
      // 并叠加参考图细节标注 (布局缩略图 + 调色板色卡)
      img = referenceSrc.clone().cover({ w: W, h: H });
      dimImage(img, 0.88); // 轻微压暗, 让白色卡位与商品更突出
      const box = Math.round(Math.min(W, H) * 0.56);
      const pad = Math.round(Math.min(W, H) * 0.03);
      const cardW = box + pad * 2;
      const cx = Math.round((W - cardW) / 2);
      const cy = Math.round((H - cardW) / 2);
      // 半透明白卡: 商品从参考场景中"浮"出, 避免花哨背景吞掉主体
      const card = new Jimp({ width: cardW, height: cardW, color: 0xffffffe6 });
      img.composite(card, cx, cy);
      const cut = productSrc.clone().cover({ w: box, h: box });
      img.composite(cut, cx + pad, cy + pad);
      drawRectBorder(img, cx + pad, cy + pad, box, box, Math.max(2, Math.round(W / 256)), 0xffffffff);
      await drawLayoutThumb(img, layout, GRID);
      await drawPaletteChips(img, palette);
    }

    // 底部信息带: 复刻要求 + 商品信息 (深色半透明底 + 白字, 任意场景下可读)
    await drawCloneCaption(img, [
      `PRODUCT: ${tag}`,
      requirement ? `REQUIREMENT: ${requirement}` : 'REQUIREMENT: (none)',
    ]);
    await drawFooterBar(img, `HOT REMAKE (MOCK) degree=${degree} ${W}x${H}`);
    return { kind: 'image' as const, buffer: await img.getBuffer(JimpMime.jpeg), format: 'image/jpeg' };
  }

  // ── mock: 自由创作 (参考站 free-creation: 参考图 0~4 张 + 提示词, 占位渲染) ──
  private async makeFreeCreation(inputPaths: string[], params: Record<string, any>) {
    // 参考图选填 (0~4 张, 顺序保留; 前端页面上限 4), 提示词必填
    const refs = inputPaths.filter(Boolean).slice(0, 4);
    const size = params.size === '2k' ? 2048 : 1024;
    const ratioH = parseRatio(params.ratio, 1);
    const W = size;
    const H = Math.max(64, Math.round(size * ratioH));
    const prompt = asciiOnly(params.prompt, 600); // 换行逻辑控制行长, 中文部分被剥离
    const fontPx = W >= 1600 ? 64 : 32;
    const footerH = fontPx === 64 ? 88 : 44;

    const img = new Jimp({ width: W, height: H, color: 0xffffffff });
    const stripH = refs.length > 0 ? Math.round(H * 0.28) : 0;

    if (refs.length > 0) {
      // 参考图真实参与: 顶部浅灰条带横排参考图 (cover 统一方图, 张数即输入张数)
      const strip = new Jimp({ width: W, height: stripH, color: 0xf2f4f7ff });
      img.composite(strip, 0, 0);
      const pad = Math.round(W * 0.03);
      const gap = Math.round(W * 0.015);
      const cell = Math.max(48, Math.floor((W - pad * 2 - gap * (refs.length - 1)) / refs.length));
      const box = Math.max(48, Math.min(cell, stripH - pad * 2));
      const y0 = Math.round((stripH - box) / 2);
      for (let i = 0; i < refs.length; i++) {
        const ref = await Jimp.read(refs[i]);
        const cut = ref.cover({ w: box, h: box });
        img.composite(cut, pad + i * (cell + gap) + Math.round((cell - box) / 2), y0);
      }
    }

    // 主视觉区: 品牌紫渐变 + 提示词多行白字 (有参考图时文字区在参考条带下方)
    const mainTop = stripH;
    const mainH = H - footerH - mainTop;
    if (mainH > 0) {
      const grad = makeVerticalGradient(W, mainH, [0x80, 0x64, 0xf6], [0x55, 0x46, 0xd8]);
      img.composite(grad, 0, mainTop);
      const lines = wrapAsciiText(prompt || 'FREE CREATION', 60);
      const lineH = fontPx + 10;
      const totalH = lines.length * lineH;
      let ty = mainTop + Math.max(8, Math.round((mainH - totalH) / 2));
      for (const line of lines.slice(0, 8)) {
        await printText(img, line, Math.round(W * 0.06), ty, 'white');
        ty += lineH;
      }
    }

    await drawFooterBar(img, `FREE CREATION (MOCK) refs=${refs.length} ${W}x${H}`);
    return { kind: 'image' as const, buffer: await img.getBuffer(JimpMime.jpeg), format: 'image/jpeg' };
  }

  // ── real: 一键抠图 (背景色板 + 输出比例) ──
  private async makeMatting(inputPaths: string[], params: Record<string, any>) {
    const inputPath = requireInput(inputPaths, 'matting');
    const src = await Jimp.read(inputPath);
    const { data, width, height } = src.bitmap;
    // 背景识别: 四角采样估计底色, 与底色距离小于阈值的像素视为背景
    // (参考站该页无阈值控件, 60 对白底/纯色底商品图适用, 作为内部常量)
    const threshold = 60;

    const corners = [
      samplePixel(data, 0, 0, width),
      samplePixel(data, width - 1, 0, width),
      samplePixel(data, 0, height - 1, width),
      samplePixel(data, width - 1, height - 1, width),
    ];
    const bg = {
      r: avg(corners.map((c) => c.r)),
      g: avg(corners.map((c) => c.g)),
      b: avg(corners.map((c) => c.b)),
    };

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const dist = Math.sqrt((r - bg.r) ** 2 + (g - bg.g) ** 2 + (b - bg.b) ** 2);
      if (dist < threshold) data[i + 3] = 0; // 背景 → 透明
    }

    // 背景颜色: transparent 保持透明输出 PNG; 其余颜色按目标比例合成到画布
    const bgColor = resolveBackdropColor(params);
    const target = outputSizeFor(width, height, params.ratio);
    if (bgColor === 'transparent' && target.w === width && target.h === height) {
      return { kind: 'image' as const, buffer: await src.getBuffer(JimpMime.png), format: 'image/png' };
      }

    const canvas = new Jimp({
      width: target.w,
      height: target.h,
      color: bgColor === 'transparent' ? 0x00000000 : bgColor,
    });
    // 原图按比例适配后居中放入画布 (不放大, 避免插值模糊)
    const fit = fitInside(width, height, target.w, target.h);
    const cut = src.clone().cover({ w: fit.w, h: fit.h });
    canvas.composite(cut, Math.round((target.w - fit.w) / 2), Math.round((target.h - fit.h) / 2));
    const label = bgColor === 'transparent' ? 'TRANSPARENT' : `BG ${bgColor.toString(16)}`;
    await drawFooterBar(canvas, `AI MATTING ${label} ${target.w}x${target.h}`);
    return { kind: 'image' as const, buffer: await canvas.getBuffer(JimpMime.jpeg), format: 'image/jpeg' };
  }

  // ── real: 智能扩图 (原图占比 + 原图位置 + 边缘延展) ──
  private async makeExpand(inputPaths: string[], params: Record<string, any>) {
    const inputPath = requireInput(inputPaths, 'expand');
    const src = await Jimp.read(inputPath);
    const sw = src.bitmap.width;
    const sh = src.bitmap.height;
    const occupy = clampInt(Math.round(Number(params.occupy) || 80), 1, 99);

    // 画布面积 = 原图面积 / 占比 (占比 100% 时不扩图, 保持原尺寸)
    const ratioH = params.ratio && params.ratio !== 'original' ? parseRatio(params.ratio, sh / sw) : sh / sw;
    // 目标长边: 由占比推导 (原图长边 / sqrt(占比)), 再用比例修正另一边
    const longSide = Math.max(sw, sh) / Math.sqrt(occupy / 100);
    let W: number;
    let H: number;
    if (sw >= sh) {
      W = Math.max(sw + 2, Math.round(longSide));
      H = Math.max(sh + 2, Math.round(W * ratioH));
    } else {
      H = Math.max(sh + 2, Math.round(longSide));
      W = Math.max(sw + 2, Math.round(H / ratioH));
    }
    W = Math.max(W, sw + 2);
    H = Math.max(H, sh + 2);

    // 原图在画布中的位置: 九宫格 (center 默认居中)
    const pos = EXPAND_POSITION_BOX[String(params.position)] ?? EXPAND_POSITION_BOX.center;
    const offX = Math.round((W - sw) * pos.fx);
    const offY = Math.round((H - sh) * pos.fy);

    const canvas = new Jimp({ width: W, height: H, color: 0xffffffff });

    // 边缘延展: 逐像素把源图四边向外"拉伸", 模拟内容补全 (纯色/渐变背景效果自然)
    const { data: sd } = src.bitmap;
    const { data: cd } = canvas.bitmap;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const inside = x >= offX && x < offX + sw && y >= offY && y < offY + sh;
        const sx = inside ? x - offX : clampInt(x - offX, 0, sw - 1);
        const sy = inside ? y - offY : clampInt(y - offY, 0, sh - 1);
        const si = (sy * sw + sx) * 4;
        const di = (y * W + x) * 4;
        cd[di] = sd[si];
        cd[di + 1] = sd[si + 1];
        cd[di + 2] = sd[si + 2];
        cd[di + 3] = 255;
      }
    }

    // 羽化: 在原图边界外做一圈渐变过渡, 减轻拼接感 (固定 8px, 参考站该页无此控件)
    applyFeather(canvas, offX, offY, sw, sh, 8);

    await drawFooterBar(canvas, `AI EXPAND occupy ${occupy}% pos ${params.position} ${W}x${H}`);
    return { kind: 'image' as const, buffer: await canvas.getBuffer(JimpMime.jpeg), format: 'image/jpeg' };
  }

  // ── real: 旋转角度 (yaw 水平旋转 + pitch 俯仰剪切 + zoom 缩放, 2D 近似) ──
  private async makeRotate(inputPaths: string[], params: Record<string, any>) {
    const inputPath = requireInput(inputPaths, 'rotate');
    const src = await Jimp.read(inputPath);
    const yaw = clampNum(Number(params.yaw) || 0, -90, 90);
    const pitch = clampNum(Number(params.pitch) || 0, -30, 60);
    const zoom = clampNum(Number(params.zoom) || 1, 0.8, 1.2);

    // 目标画布: 原比例保持源尺寸; 指定比例按该比例生成 (仅缩小不放大, 长边上限 2048)
    const target = outputSizeFor(src.bitmap.width, src.bitmap.height, params.ratio, 2048);
    const canvas = new Jimp({ width: target.w, height: target.h, color: 0xffffffff });

    // zoom: 源图按中心缩放 (contain 适配画布)
    const fit = fitInside(
      Math.round(src.bitmap.width * zoom),
      Math.round(src.bitmap.height * zoom),
      target.w,
      target.h,
    );
    let work = src.clone().cover({ w: fit.w, h: fit.h });

    // yaw: 平面旋转 (mode:false 保持画布, 空角留白由白底画布兜住)
    if (yaw !== 0) work = work.rotate({ deg: yaw, mode: false });

    // pitch: 俯仰角的 2D 近似 —— 逐行水平剪切 (上/下边缘反向偏移形成梯形),
    // 模拟"镜头俯仰导致的透视变形" (真实 3D 重建需 AI 模型, 页面已披露)
    if (pitch !== 0) {
      const sheared = work.clone();
      const { data: sd, width: sw2, height: sh2 } = work.bitmap;
      const { data: dd } = sheared.bitmap;
      for (let y = 0; y < sh2; y++) {
        // t: -0.5(顶) .. 0.5(底); 顶行向左收, 底行向右收 (pitch>0 俯视感)
        const t = sh2 <= 1 ? 0 : y / (sh2 - 1) - 0.5;
        const shift = t * pitch * (sw2 / 90);
        for (let x = 0; x < sw2; x++) {
          const sx = clampInt(Math.round(x + shift), 0, sw2 - 1);
          const si = (y * sw2 + sx) * 4;
          const di = (y * sw2 + x) * 4;
          dd[di] = sd[si];
          dd[di + 1] = sd[si + 1];
          dd[di + 2] = sd[si + 2];
          dd[di + 3] = sd[si + 3];
        }
      }
      work = sheared;
    }

    canvas.composite(work, Math.round((target.w - work.bitmap.width) / 2), Math.round((target.h - work.bitmap.height) / 2));
    await drawFooterBar(canvas, `AI VIEW yaw ${yaw} pitch ${pitch} zoom ${zoom} ${target.w}x${target.h}`);
    return { kind: 'image' as const, buffer: await canvas.getBuffer(JimpMime.jpeg), format: 'image/jpeg' };
  }

  // ── real: 商品换色 (保明度换色相; 目标色取自参考站色板或自定义 HEX) ──
  private async makeRecolor(inputPaths: string[], params: Record<string, any>) {
    const inputPath = requireInput(inputPaths, 'recolor');
    const img = await Jimp.read(inputPath);
    // color=custom 时取 customColor; 非法 HEX 回落经典蓝 (与 hexToRgb 兜底一致)
    const colorKey = String(params.color ?? '#FFFFFF');
    const targetHex = colorKey === 'custom' ? String(params.customColor ?? '') : colorKey;
    const target = hexToRgb(targetHex);

    const product = estimateProductColor(img);
    const limit = 180; // 容差内部常量 (参考站该页无容差控件)
    const maxRatio = Math.max(product.r, product.g, product.b, 1);
    const tr = Math.max(target.r, 1);
    const tg = Math.max(target.g, 1);
    const tb = Math.max(target.b, 1);

    const { data } = img.bitmap;
    let replaced = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] === 0) continue;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const dist = Math.sqrt((r - product.r) ** 2 + (g - product.g) ** 2 + (b - product.b) ** 2);
      if (dist > limit) continue;
      // 用原像素相对主体色的明度比例去乘目标色, 高光/阴影层次得以保留
      const lum = Math.max(r, g, b) / maxRatio;
      data[i] = clampInt(Math.round(tr * lum), 0, 255);
      data[i + 1] = clampInt(Math.round(tg * lum), 0, 255);
      data[i + 2] = clampInt(Math.round(tb * lum), 0, 255);
      replaced++;
    }

    const tag = colorKey === 'custom' ? targetHex : colorKey;
    await drawFooterBar(img, `AI RECOLOR ${tag} (${replaced}px)`);
    return { kind: 'image' as const, buffer: await img.getBuffer(JimpMime.jpeg), format: 'image/jpeg' };
  }

  // ── real: 产品精修 (6 模式像素管线 + 补充要求记录) ──
  private async makeEnhance(inputPaths: string[], params: Record<string, any>) {
    const inputPath = requireInput(inputPaths, 'enhance');
    const src = await Jimp.read(inputPath);
    const mode = String(params.mode ?? 'comprehensive');
    const m = RETOUCH_PIPELINE[mode] ?? RETOUCH_PIPELINE.comprehensive;

    // 画布: 原比例保持源尺寸 (仅缩小不放大), 指定比例按该比例适配
    const target = outputSizeFor(src.bitmap.width, src.bitmap.height, params.ratio, 2048);
    const img: Img =
      target.w === src.bitmap.width && target.h === src.bitmap.height
        ? src
        : (() => {
            const canvas: Img = new Jimp({ width: target.w, height: target.h, color: 0xffffffff });
            const fit = fitInside(src.bitmap.width, src.bitmap.height, target.w, target.h);
            canvas.composite(src.clone().cover({ w: fit.w, h: fit.h }), Math.round((target.w - fit.w) / 2), Math.round((target.h - fit.h) / 2));
            return canvas;
          })();

    const { data } = img.bitmap;
    const contrastFactor = (259 * (m.contrast + 255)) / (255 * (259 - m.contrast));
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] === 0) continue;
      let r = data[i] + m.brightness;
      let g = data[i + 1] + m.brightness;
      let bl = data[i + 2] + m.brightness;

      r = contrastFactor * (r - 128) + 128;
      g = contrastFactor * (g - 128) + 128;
      bl = contrastFactor * (bl - 128) + 128;

      if (m.saturation !== 0) {
        const gray = 0.299 * r + 0.587 * g + 0.114 * bl;
        r = gray + (r - gray) * (1 + m.saturation / 100);
        g = gray + (g - gray) * (1 + m.saturation / 100);
        bl = gray + (bl - gray) * (1 + m.saturation / 100);
      }

      data[i] = clampInt(Math.round(r), 0, 255);
      data[i + 1] = clampInt(Math.round(g), 0, 255);
      data[i + 2] = clampInt(Math.round(bl), 0, 255);
    }

    // 瑕疵修复: 轻度模糊近似去噪 (真实瑕疵修复需 inpainting 模型)
    if (m.blur > 0) {
      const blurred = img.clone().blur(m.blur);
      const bd = blurred.bitmap.data;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] === 0) continue;
        // 半混合: 保留部分原细节, 只柔化高频噪点
        data[i] = clampInt(Math.round((data[i] + bd[i]) / 2), 0, 255);
        data[i + 1] = clampInt(Math.round((data[i + 1] + bd[i + 1]) / 2), 0, 255);
        data[i + 2] = clampInt(Math.round((data[i + 2] + bd[i + 2]) / 2), 0, 255);
      }
    }

    // 清晰度/质感/材质: unsharp mask (与自身模糊版做差值放大)
    if (m.sharpen > 0) {
      const blurred = img.clone().blur(m.sharpen);
      const bd = blurred.bitmap.data;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] === 0) continue;
        data[i] = clampInt(Math.round(data[i] + (data[i] - bd[i]) * m.amount), 0, 255);
        data[i + 1] = clampInt(Math.round(data[i + 1] + (data[i + 1] - bd[i + 1]) * m.amount), 0, 255);
        data[i + 2] = clampInt(Math.round(data[i + 2] + (data[i + 2] - bd[i + 2]) * m.amount), 0, 255);
      }
    }

    // 补充要求: 中文原文完整记录在任务参数中, 图内仅绘制 ASCII 部分 (Jimp 字体限制)
    const note = asciiOnly(params.note, 60);
    if (note) await printText(img, `NOTE: ${note}`, 16, 16, 'black');
    await drawFooterBar(img, `AI RETOUCH mode=${mode} ${target.w}x${target.h}`);
    return { kind: 'image' as const, buffer: await img.getBuffer(JimpMime.jpeg), format: 'image/jpeg' };
  }

  // ── mock: 局部重绘 (区域框 + 描述; 真实重绘需 inpainting 模型) ──
  private async makeLocalRedraw(inputPaths: string[], params: Record<string, any>) {
    const inputPath = requireInput(inputPaths, 'local_redraw');
    const src = await Jimp.read(inputPath);
    // 画布: 原比例保持源尺寸; 画质档位作为长边上限 (仅缩小不放大)
    const target = outputSizeFor(src.bitmap.width, src.bitmap.height, params.ratio, params.size === '2k' ? 2048 : 1024);
    const W = target.w;
    const H = target.h;
    const canvas = new Jimp({ width: W, height: H, color: 0xf1f5f9ff });
    const fit = fitInside(src.bitmap.width, src.bitmap.height, W, H);
    const base = src.clone().cover({ w: fit.w, h: fit.h });
    const bx = Math.round((W - fit.w) / 2);
    const by = Math.round((H - fit.h) / 2);
    canvas.composite(base, bx, by);

    // 重绘区域: 按比例映射到画布 (参考站在画布上涂抹, 本地以位置枚举代替)
    const rel = REDRAW_REGION_BOX[params.region] ?? REDRAW_REGION_BOX.center;
    const region = {
      x: bx + Math.round(fit.w * rel.fx),
      y: by + Math.round(fit.h * rel.fy),
      w: Math.round(fit.w * rel.fw),
      h: Math.round(fit.h * rel.fh),
    };
    const frame = new Jimp({ width: region.w, height: region.h, color: 0x00000000 });
    const t = Math.max(2, Math.round(W / 256));
    for (let i = 0; i < t; i++) {
      for (let x = 0; x < region.w; x++) {
        frame.setPixelColor(0xea580cff, x, i);
        frame.setPixelColor(0xea580cff, x, region.h - 1 - i);
      }
      for (let y = 0; y < region.h; y++) {
        frame.setPixelColor(0xea580cff, i, y);
        frame.setPixelColor(0xea580cff, region.w - 1 - i, y);
      }
    }
    canvas.composite(frame, region.x, region.y);

    const prompt = asciiOnly(params.prompt, 40);
    if (prompt) await printText(canvas, `REDRAW: ${prompt}`, region.x, Math.min(region.y + region.h + 12, H - 48));
    await drawFooterBar(canvas, 'LOCAL REDRAW (MOCK) - needs real model');
    return { kind: 'image' as const, buffer: await canvas.getBuffer(JimpMime.jpeg), format: 'image/jpeg' };
  }

  // ── mock: 图片翻译 (目标语言文本块模拟; 真实翻译需 OCR + 翻译模型) ──
  private async makeImageTranslate(inputPaths: string[], params: Record<string, any>) {
    const inputPath = requireInput(inputPaths, 'image_translate');
    const src = await Jimp.read(inputPath);
    const size = params.size === '2k' ? 2048 : 1024;
    const target = outputSizeFor(src.bitmap.width, src.bitmap.height, 'original', size);
    const W = target.w;
    const H = target.h;
    const canvas = new Jimp({ width: W, height: H, color: 0xf1f5f9ff });
    const fit = fitInside(src.bitmap.width, src.bitmap.height, W, H);
    canvas.composite(src.clone().cover({ w: fit.w, h: fit.h }), Math.round((W - fit.w) / 2), Math.round((H - fit.h) / 2));

    // 模拟"检测到的文字块被替换为目标语言": 半透明条 + 目标语言示例文案
    const lang = LANG_LABEL_BY_CODE[String(params.targetLang)] ?? 'TEXT';
    const protect = params.protectSubject !== false;
    const blocks = Math.min(3, 1 + Math.floor(H / 500));
    for (let i = 0; i < blocks; i++) {
      const y = Math.round(H * 0.2) + i * Math.round(H * 0.16);
      const block = new Jimp({ width: Math.round(W * 0.7), height: Math.round(H * 0.07), color: 0x0f172a14 });
      canvas.composite(block, Math.round(W * 0.12), y);
      await printText(canvas, `${lang} sample ${i + 1}`, Math.round(W * 0.14), y + Math.round(H * 0.018));
    }
    if (protect) {
      // 保护商品主体: 在主体估计区域画保持框, 明示该区域不参与文字替换
      const box = fitInside(src.bitmap.width, src.bitmap.height, W, H);
      drawRectBorder(
        canvas,
        Math.round((W - box.w) / 2),
        Math.round((H - box.h) / 2),
        box.w,
        box.h,
        Math.max(2, Math.round(W / 256)),
        0x16a34acc,
      );
    }
    await drawFooterBar(canvas, `IMAGE TRANSLATE (MOCK) -> ${lang}${protect ? ' protect' : ''}`);
    return { kind: 'image' as const, buffer: await canvas.getBuffer(JimpMime.jpeg), format: 'image/jpeg' };
  }

  // ── mock: 多图融合 (场景版式 + 真实图片层叠; 非 AI 语义融合) ──
  private async makeMultiFusion(inputPaths: string[], params: Record<string, any>) {
    const paths = inputPaths.filter(Boolean);
    if (paths.length < 2) throw new Error('multi_fusion 需要主体图与搭配图');
    const subject = await Jimp.read(paths[0]);
    const accents = await Promise.all(paths.slice(1, 6).map((p) => Jimp.read(p)));

    const size = params.size === '2k' ? 2048 : 1024;
    const ratioH = parseRatio(params.ratio, 1);
    const W = size;
    const H = Math.max(64, Math.round(size * ratioH));
    const scene = String(params.scene ?? 'print_pattern');
    const variantCount = clampInt(Number(params.variantCount) || 4, 1, 4);
    const layout = FUSION_LAYOUTS[scene] ?? FUSION_LAYOUTS.print_pattern;

    // 变体张数 → 一张联络图 (contact sheet): 每格一种版式变体, 一眼可数
    const cols = variantCount <= 1 ? 1 : 2;
    const rows = Math.ceil(variantCount / cols);
    const gap = Math.max(4, Math.round(W / 128));
    const cellW = Math.round((W - gap * (cols + 1)) / cols);
    const cellH = Math.round((H - gap * (rows + 1)) / rows);
    const sheet = new Jimp({ width: W, height: H, color: 0xffffffff });

    for (let v = 0; v < variantCount; v++) {
      const cx = gap + (v % cols) * (cellW + gap);
      const cy = gap + Math.floor(v / cols) * (cellH + gap);
      // 变体差异: 搭配图数量与位置随 v 变化 (v0 用全部搭配图, 后续逐步精简)
      const useAccents = accents.slice(0, Math.max(1, accents.length - v));
      await this.composeFusionCell(sheet, subject, useAccents, layout, cx, cy, cellW, cellH, v);
    }

    await drawFooterBar(sheet, `MULTI FUSION (MOCK) scene ${scene} variants ${variantCount} ${W}x${H}`);
    return { kind: 'image' as const, buffer: await sheet.getBuffer(JimpMime.jpeg), format: 'image/jpeg' };
  }

  /** 融合单格: 场景版式决定搭配图排布, 主体图居中 (真实像素层叠, 非 AI) */
  private async composeFusionCell(
    sheet: Img,
    subject: Img,
    accents: Img[],
    layout: { mode: 'surface' | 'space'; label: string },
    cx: number,
    cy: number,
    cw: number,
    ch: number,
    variant: number,
  ): Promise<void> {
    const cell = new Jimp({ width: cw, height: ch, color: 0xffffffff });
    const pad = Math.max(3, Math.round(cw / 48));

    // 主体图: contain 适配, 占单元格约 62% (表面附着) / 48% (空间摆放)
    const subjBox = Math.round(Math.min(cw, ch) * (layout.mode === 'surface' ? 0.62 : 0.48));
    const subj = subject.clone().cover({ w: subjBox, h: subjBox });
    cell.composite(subj, Math.round((cw - subjBox) / 2), Math.round((ch - subjBox) / 2));

    // 搭配图: 表面附着 → 四角贴纸式环绕; 空间摆放 → 底部一字排开
    if (accents.length > 0) {
      const accBox = Math.round(Math.min(cw, ch) * 0.2);
      accents.forEach((acc, i) => {
        const cut = acc.clone().cover({ w: accBox, h: accBox });
        let ax: number;
        let ay: number;
        if (layout.mode === 'surface') {
          const corners = [
            [pad, pad],
            [cw - accBox - pad, pad],
            [pad, ch - accBox - pad],
            [cw - accBox - pad, ch - accBox - pad],
          ];
          const [ox, oy] = corners[i % corners.length];
          ax = ox;
          ay = oy;
        } else {
          const total = Math.min(accents.length, 4);
          ax = clampInt(Math.round((cw - (total * accBox + (total - 1) * pad)) / 2) + i * (accBox + pad), pad, cw - accBox - pad);
          ay = ch - accBox - pad;
        }
        cell.composite(cut, ax, ay);
      });
    }

    // 变体编号角标 (真实参数, 非装饰)
    drawRectBorder(cell, 0, 0, cw, ch, Math.max(2, Math.round(cw / 64)), 0x5546d8cc);
    await printText(cell, `V${variant + 1}`, Math.max(4, pad), Math.max(4, pad), 'black');
    sheet.composite(cell, cx, cy);
  }

  // ── mock: 商品SKU图 (模板 + 区域填充 + SKU 名称; 非 AI 套版) ──
  private async makeSkuImage(inputPaths: string[], params: Record<string, any>) {
    const inputPath = requireInput(inputPaths, 'sku_image');
    const src = await Jimp.read(inputPath);
    const size = params.size === '2k' ? 2048 : 1024;
    const ratioH = parseRatio(params.ratio, 1);
    const W = size;
    const H = Math.max(64, Math.round(size * ratioH));

    const canvas = new Jimp({ width: W, height: H, color: 0xffffffff });
    const template = src.clone().cover({ w: W, h: H });
    canvas.composite(template, 0, 0);

    // 变体区域: 位置枚举映射到模板上的矩形, 用 SKU 颜色实底填充 (参考站为框选区域)
    const rel = SKU_REGION_BOX[params.region] ?? SKU_REGION_BOX.center;
    const region = {
      x: Math.round(W * rel.fx),
      y: Math.round(H * rel.fy),
      w: Math.round(W * rel.fw),
      h: Math.round(H * rel.fh),
    };
    const colorKey = String(params.skuColor ?? '#FFFFFF');
    const hex = colorKey === 'custom' ? String(params.customColor ?? '') : colorKey;
    const rgb = hexToRgb(hex);
    const fill = new Jimp({ width: region.w, height: region.h, color: rgbaToInt(rgb.r, rgb.g, rgb.b, 235) });
    canvas.composite(fill, region.x, region.y);
    drawRectBorder(canvas, region.x, region.y, region.w, region.h, Math.max(2, Math.round(W / 256)), 0x5546d8ff);

    // SKU 名称: 中文原文记录于任务参数, 图内绘制 ASCII 部分
    const sku = asciiOnly(params.skuName, 40);
    if (sku) {
      await printText(canvas, sku, region.x + 8, region.y + Math.round(region.h / 2) - 16, 'black');
    }
    await printText(canvas, `SKU ${hex}`, 16, H - 56, 'black');
    await drawFooterBar(canvas, `SKU IMAGE (MOCK) region ${params.region} ${W}x${H}`);
    return { kind: 'image' as const, buffer: await canvas.getBuffer(JimpMime.jpeg), format: 'image/jpeg' };
  }

  // ── mock: 依赖真实模型的能力 (创意生图 / 去除水印) ──
  private async makePlaceholder(capability: string, inputPaths: string[], params: Record<string, any>) {
    const inputPath = requireInput(inputPaths, capability);
    const src = await Jimp.read(inputPath);
    const W = 900;
    const H = 900;
    const canvas = new Jimp({ width: W, height: H, color: 0xf1f5f9ff });
    const base = src.cover({ w: W - 80, h: H - 200 });
    canvas.composite(base, 40, 40);

    const def = getCapability(capability)!;
    /*
     * ⚠️ 这里仍是 switch, 但它**不是能力分派** —— 别把它和上面那处混淆。
     *
     * 分派已改为按 localImpl 句柄取实现; 这一处只决定占位图上画什么装饰
     * (页脚文案 / 是否糊一块水印区)。新增能力不需要碰这里:
     * 落到 default 分支会得到"能力名 (MOCK)"的页脚, 正是期望行为。
     *
     * 保留 switch 而非改映射表: 它有两个分支且形状不一致 (一个要 src 克隆),
     * 抽成表反而更绕; 而它的 default 是**安全**的, 不存在"漏分支就崩"。
     */
    switch (capability) {
      case 'creative_image': {
        const prompt = asciiOnly(params.prompt, 40);
        if (prompt) await printText(canvas, `"${prompt}"`, 48, H - 150);
        await drawFooterBar(canvas, 'CREATIVE IMAGE (MOCK) - needs real model');
        break;
      }
      case 'remove_watermark': {
        const region = WATERMARK_BOX[params.region] ?? WATERMARK_BOX.bottom_right;
        const patch = src.clone().crop({ x: region.sx, y: region.sy, w: region.sw, h: region.sh }).blur(6);
        canvas.composite(patch, region.x, region.y);
        await drawFooterBar(canvas, 'WATERMARK REMOVE (MOCK) - needs real model');
        break;
      }
      default:
        await drawFooterBar(canvas, `${def.name} (MOCK)`);
    }

    return { kind: 'image' as const, buffer: await canvas.getBuffer(JimpMime.jpeg), format: 'image/jpeg' };
  }
}

// ───────────────── 常量与像素辅助 ─────────────────

/** 产品精修 6 模式像素管线 (参考站 retouch-mode-options; 本地真实算法近似) */
const RETOUCH_PIPELINE: Record<
  string,
  { brightness: number; contrast: number; saturation: number; blur: number; sharpen: number; amount: number }
> = {
  comprehensive: { brightness: 4, contrast: 8, saturation: 8, blur: 0, sharpen: 1, amount: 0.5 },
  texture: { brightness: 2, contrast: 14, saturation: 4, blur: 0, sharpen: 2, amount: 0.7 },
  blemish: { brightness: 3, contrast: 2, saturation: 2, blur: 3, sharpen: 0, amount: 0 },
  color: { brightness: 0, contrast: 6, saturation: 22, blur: 0, sharpen: 0, amount: 0 },
  clarity: { brightness: 2, contrast: 12, saturation: 0, blur: 0, sharpen: 3, amount: 0.9 },
  material: { brightness: 0, contrast: 10, saturation: 6, blur: 0, sharpen: 2, amount: 0.6 },
};

/** 局部重绘区域 → 相对坐标 (fx/fy/fw/fh, 参考站为画布涂抹, 本地以位置枚举代替) */
const REDRAW_REGION_BOX: Record<string, { fx: number; fy: number; fw: number; fh: number }> = {
  center: { fx: 0.25, fy: 0.25, fw: 0.5, fh: 0.5 },
  top: { fx: 0.25, fy: 0.08, fw: 0.5, fh: 0.28 },
  bottom: { fx: 0.25, fy: 0.64, fw: 0.5, fh: 0.28 },
  left: { fx: 0.06, fy: 0.25, fw: 0.3, fh: 0.5 },
  right: { fx: 0.64, fy: 0.25, fw: 0.3, fh: 0.5 },
  full: { fx: 0.03, fy: 0.03, fw: 0.94, fh: 0.94 },
};

/** SKU 变体区域 → 模板相对坐标 (参考站为框选, 本地以位置枚举代替) */
const SKU_REGION_BOX: Record<string, { fx: number; fy: number; fw: number; fh: number }> = {
  center: { fx: 0.2, fy: 0.2, fw: 0.6, fh: 0.6 },
  top: { fx: 0.2, fy: 0.08, fw: 0.6, fh: 0.3 },
  bottom: { fx: 0.2, fy: 0.62, fw: 0.6, fh: 0.3 },
  left: { fx: 0.06, fy: 0.2, fw: 0.3, fh: 0.6 },
  right: { fx: 0.64, fy: 0.2, fw: 0.3, fh: 0.6 },
};

/** 智能扩图原图位置 → 画布内对齐系数 (fx/fy: 0=顶/左, 0.5=中, 1=底/右) */
const EXPAND_POSITION_BOX: Record<string, { fx: number; fy: number }> = {
  'top-left': { fx: 0, fy: 0 },
  top: { fx: 0.5, fy: 0 },
  'top-right': { fx: 1, fy: 0 },
  left: { fx: 0, fy: 0.5 },
  center: { fx: 0.5, fy: 0.5 },
  right: { fx: 1, fy: 0.5 },
  'bottom-left': { fx: 0, fy: 1 },
  bottom: { fx: 0.5, fy: 1 },
  'bottom-right': { fx: 1, fy: 1 },
};

/**
 * 多图融合场景版式: 表面附着类 (图案贴到主体上) 与空间摆放类 (搭配图环绕主体)
 * 决定搭配图的排布方式; 主体图始终居中, 层叠是真实像素合成。
 */
const FUSION_LAYOUTS: Record<string, { mode: 'surface' | 'space'; label: string }> = {
  print_pattern: { mode: 'surface', label: 'PRINT' },
  embroidery: { mode: 'surface', label: 'EMBROIDERY' },
  texture: { mode: 'surface', label: 'TEXTURE' },
  sticker: { mode: 'surface', label: 'STICKER' },
  hot_stamping: { mode: 'surface', label: 'FOIL' },
  carving: { mode: 'surface', label: 'CARVE' },
  painting: { mode: 'surface', label: 'PAINT' },
  table_display: { mode: 'space', label: 'TABLE' },
  wearing: { mode: 'space', label: 'WEAR' },
  scene_match: { mode: 'space', label: 'SCENE' },
  handheld: { mode: 'space', label: 'HANDHELD' },
  combo_set: { mode: 'space', label: 'COMBO' },
  food_plating: { mode: 'space', label: 'FOOD' },
  storage_display: { mode: 'space', label: 'STORAGE' },
  shelf_display: { mode: 'space', label: 'SHELF' },
};

/** 目标语言 → 图内示例文案标签 (Jimp 字体仅 ASCII, 中文标签只出现在界面) */
const LANG_LABEL_BY_CODE: Record<string, string> = {
  'zh-CN': 'ZH',
  'en-US': 'EN',
  'ru-RU': 'RU',
  'es-ES': 'ES',
  'de-DE': 'DE',
  'ja-JP': 'JA',
  'ko-KR': 'KO',
  'pt-PT': 'PT',
  'id-ID': 'ID',
  'th-TH': 'TH',
};

const WATERMARK_BOX: Record<string, { x: number; y: number; sx: number; sy: number; sw: number; sh: number }> = {
  bottom_right: { x: 560, y: 620, sx: 0, sy: 0, sw: 340, sh: 280 },
  bottom_left: { x: 60, y: 620, sx: 0, sy: 0, sw: 340, sh: 280 },
  top_right: { x: 560, y: 40, sx: 0, sy: 0, sw: 340, sh: 280 },
  top_left: { x: 60, y: 40, sx: 0, sy: 0, sw: 340, sh: 280 },
  center: { x: 300, y: 340, sx: 0, sy: 0, sw: 340, sh: 280 },
};

function clampInt(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

function clampNum(v: number, min: number, max: number): number {
  return Number.isFinite(v) ? clampInt(v, min, max) : min;
}

/**
 * 输出尺寸: ratio='original' 保持源比例, 否则按目标比例;
 * longSideMax 作为长边上限 (仅缩小不放大 —— 放大不增加信息, 本地算法不做插值虚增)。
 */
function outputSizeFor(
  srcW: number,
  srcH: number,
  ratio: string | undefined,
  longSideMax = 2048,
): { w: number; h: number } {
  const ratioH = ratio && ratio !== 'original' ? parseRatio(ratio, srcH / srcW) : srcH / srcW;
  const long = Math.max(srcW, srcH);
  const capped = Math.min(long, longSideMax);
  const k = capped / long;
  let w = Math.max(2, Math.round(srcW * k));
  let h = Math.max(2, Math.round(srcH * k));
  // 指定比例时校正另一边 (以短边为基准, 避免超出长边上限)
  if (ratio && ratio !== 'original') {
    if (w >= h) h = Math.max(2, Math.round(w * ratioH));
    else w = Math.max(2, Math.round(h / ratioH));
  }
  return { w, h };
}

/** 源图 contain 适配进目标框 (不放大) */
function fitInside(srcW: number, srcH: number, boxW: number, boxH: number): { w: number; h: number } {
  const k = Math.min(boxW / srcW, boxH / srcH, 1);
  return { w: Math.max(2, Math.round(srcW * k)), h: Math.max(2, Math.round(srcH * k)) };
}

/**
 * 背景颜色参数 → Jimp int 色值或 'transparent'。
 * transparent=透明输出; custom 取 customColor (非法 HEX 回落白色);
 * 其余为参考站色板的 HEX (枚举值即 HEX)。
 */
function resolveBackdropColor(params: Record<string, any>): number | 'transparent' {
  const key = String(params.bgColor ?? 'transparent');
  if (key === 'transparent') return 'transparent';
  if (key === 'custom') {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(params.customColor ?? '').trim());
    if (!m) return 0xffffffff;
    const n = parseInt(m[1], 16);
    return rgbaToInt((n >> 16) & 255, (n >> 8) & 255, n & 255, 255);
  }
  const rgb = hexToRgb(key);
  return rgbaToInt(rgb.r, rgb.g, rgb.b, 255);
}

function samplePixel(data: Buffer, x: number, y: number, width: number) {
  const i = (y * width + x) * 4;
  return { r: data[i], g: data[i + 1], b: data[i + 2] };
}

function avg(values: number[]): number {
  return Math.round(values.reduce((s, v) => s + v, 0) / values.length);
}

/** 估计"商品主体色": 排除近白/近灰背景后取平均色 */
function estimateProductColor(img: Img): { r: number; g: number; b: number } {
  const { data, width, height } = img.bitmap;
  const step = Math.max(1, Math.floor(Math.min(width, height) / 120));
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * 4;
      if (data[i + 3] < 32) continue;
      const pr = data[i];
      const pg = data[i + 1];
      const pb = data[i + 2];
      const max = Math.max(pr, pg, pb);
      const min = Math.min(pr, pg, pb);
      // 饱和度足够 (不是灰底) 且不是纯白
      if (max - min < 24 || max > 245) continue;
      r += pr;
      g += pg;
      b += pb;
      n++;
    }
  }
  if (n === 0) return { r: 0x25, g: 0x63, b: 0xeb };
  return { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n) };
}

/** 在原图边界外做渐变羽化, 减轻边缘延展的拼接感 */
function applyFeather(
  canvas: Img,
  offX: number,
  offY: number,
  srcW: number,
  srcH: number,
  feather: number,
): void {
  const { data, width, height } = canvas.bitmap;
  const fade = (x: number, y: number): number => {
    const dx = Math.min(x - offX, offX + srcW - 1 - x);
    const dy = Math.min(y - offY, offY + srcH - 1 - y);
    const d = Math.min(dx, dy);
    if (d >= 0) return 0;
    return Math.min(1, -d / feather);
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const f = fade(x, y);
      if (f <= 0) continue;
      const i = (y * width + x) * 4;
      const local = clampInt(Math.round(255 * f), 0, 255);
      data[i] = Math.round(data[i] * local / 255 + 255 * (1 - local / 255));
      data[i + 1] = Math.round(data[i + 1] * local / 255 + 255 * (1 - local / 255));
      data[i + 2] = Math.round(data[i + 2] * local / 255 + 255 * (1 - local / 255));
    }
  }
}
