import { join } from 'path';
import { Logger } from '@nestjs/common';
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
import { parseSkuRegions, resolveSkuColor, type SkuRegionBox } from '../capabilities/definitions/sku_image';

/**
 * 本地 Provider —— 只做**真实**像素算法, 不含任何占位图。
 *
 * 11 项图像能力各自有一套可用的 Jimp / 自研算法 (主图 / 详情图 / 爆款复刻 /
 * 抠图 / 扩图 / 换色 / 旋转 / 精修 / 去水印 / 多图融合 / SKU 图), 云端通道不可用时
 * 由它兜底出图。没有本地算法的能力 (创意生图 / 局部重绘 / 图片翻译 / 自由创作)
 * 不在这里登记, 定义里写 `localFallback: false` —— 没通道就 42204 失败并退款,
 * 绝不交付一张看起来像模型产出的假图。2026-10-22 移除了全部占位实现。
 *
 * 2026-10-22 起文件与类名统一为 `local-image.provider.ts` / `LocalImageProvider`:
 * 原先叫 mock, 但那批占位实现已全部删除, 名字与行为不符比改名本身更容易误导。
 *
 * 真实模型接入方式: 另实现一个 ImageProvider 替换 providers.module.ts 的
 * IMAGE_PROVIDER 绑定即可, 业务层无感。
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

// 类在文件后半才声明, 此处用字面量名字 (引用 LocalImageProvider.name 会触发 TDZ)
const log = new Logger('LocalImageProvider');

/** 本地算法的画布长边上限。Jimp 合成在 2048 以上既慢又不增加信息。 */
const LOCAL_MAX_SIDE = 2048;

/**
 * 画质档位 → 本地输出边长。
 *
 * 1k → 1024, 其余 (2k / 4k) → 2048。**4k 在本地兑现不了**: 4096 只有云端通道给得出,
 * 走到这里说明发生了回落 —— 打 WARN 说明实际边长, 不按 4K 谎报。
 *
 * 2026-10-22: 此前是 `params.size === '2k' ? 2048 : 1024`, 4K 档放开后会被悄悄
 * 降成 1024px, 比「回落 2048」更差且不留任何痕迹。改为「非 1k 即上限」。
 */
function localOutputSide(capability: string, params: Record<string, any>): number {
  const size = String((wasProvided(params, 'resolution') ? params.resolution : params.size) ?? '1k').toLowerCase();
  if (size === '4k') {
    log.warn(`[${capability}] 本地算法无法兑现 4K, 实际按 ${LOCAL_MAX_SIDE}px 输出（需配置云端通道）`);
  }
  return size === '1k' ? 1024 : LOCAL_MAX_SIDE;
}

function requireInput(inputPaths: string[], capability: string): string {
  const p = inputPaths.find(Boolean);
  if (!p) throw new Error(`${capability} 需要至少一张输入图`);
  return p;
}

/** 参数是否由调用方显式传入（而非 sanitizeParams 补的默认值）。 */
function wasProvided(params: Record<string, any>, key: string): boolean {
  const keys = params.__providedKeys as Set<string> | undefined;
  return Boolean(keys?.has(key));
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

export class LocalImageProvider implements ImageProvider {
  async generate(
    capability: string,
    inputPaths: string[],
    rawParams: Record<string, any>,
    maskPath?: string,
  ): Promise<ImageProviderResult> {
    const def = getCapability(capability);
    if (!def) throw new Error(`unsupported capability: ${capability}`);
    if (def.mode === 'planned') {
      throw new Error(`${def.name} 尚未开放`);
    }
    const params = sanitizeParams(capability, rawParams);
    /*
     * sanitizeParams 会为每个声明参数补默认值，单看结果无法区分「用户传了
     * selectedColor」与「默认值恰好是 transparent」。新旧字段并存期必须知道
     * 调用方到底传了哪一个，否则旧 bgColor 会被新字段默认值覆盖。这里把
     * 原始 key 集合挂成不可枚举属性，仅供本地实现判 presence，不会落库。
     */
    Object.defineProperty(params, '__providedKeys', {
      value: new Set(Object.keys(rawParams ?? {})),
      enumerable: false,
    });

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
    if (impl === 'makeRemoveWatermark') {
      return this.makeRemoveWatermark(inputPaths, params, maskPath);
    }
    const fn = (
      this as unknown as Record<string, (a: string[], p: Record<string, any>) => Promise<ImageProviderResult>>
    )[impl];
    return fn.call(this, inputPaths, params);
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
        `能力 ${capability} 未声明 localImpl —— 它没有本地实现, 不应被路由到本地` +
          `（该断言也应在装配期/路由器判定触发, 走到这里说明能力定义或路由有误）`,
      );
    }
    const fn = (this as unknown as Record<string, unknown>)[key];
    if (typeof fn !== 'function') {
      throw new Error(
        `能力 ${capability} 的 localImpl "${key}" 在 LocalImageProvider 上没有对应方法 —— ` +
          `请检查该能力定义文件与本类的方法名是否一致`,
      );
    }
    return key;
  }

  // ── real: 商品主图 (参考站 product-kit: 按变体计数批量生成, 每张可见差异) ──
  private async makeMainImage(inputPaths: string[], params: Record<string, any>) {
    const inputPath = requireInput(inputPaths, 'main_image');
    // 画质档位 → 输出边长 (1k=1024, 2k/4k=2048 上限; 4K 回落会打 WARN)
    const size = localOutputSide('main_image', params);
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
    const width = localOutputSide('detail_image', params);
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

  // ── real: 爆款复刻 (参考站 viral-clone: 商品图 + 参考图, 两档复刻程度) ──
  private async makeClone(inputPaths: string[], params: Record<string, any>) {
    // 输入顺序: [0]=商品图, [1]=参考图 (前端按"上传商品图 / 上传参考图"顺序提交,
    // generate.service.processTask 已按 inputAssetIds 原序保序产出 inputPaths)
    const productPath = requireInput(inputPaths, 'hot_remake');
    const referencePath = inputPaths[1];
    const productSrc = await Jimp.read(productPath);
    const referenceSrc = referencePath ? await Jimp.read(referencePath) : productSrc;

    // 画质档位 → 输出边长; 比例 → 高宽比
    const size = localOutputSide('hot_remake', params);
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
    await drawFooterBar(img, `HOT REMAKE degree=${degree} ${W}x${H}`);
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
    const backdrop = resolveBackdropColor(params);
    const target = outputSizeFor(width, height, params.ratio, localOutputSide('matting', params));
    if (backdrop.kind === 'transparent' && target.w === width && target.h === height) {
      return { kind: 'image' as const, buffer: await src.getBuffer(JimpMime.png), format: 'image/png' };
    }

    const canvas = new Jimp({
      width: target.w,
      height: target.h,
      color: backdrop.kind === 'transparent' ? 0x00000000 : backdrop.color,
    });
    // 原图按比例适配后居中放入画布 (不放大, 避免插值模糊)
    const fit = fitInside(width, height, target.w, target.h);
    const cut = src.clone().cover({ w: fit.w, h: fit.h });
    canvas.composite(cut, Math.round((target.w - fit.w) / 2), Math.round((target.h - fit.h) / 2));
    const label = backdrop.kind === 'transparent' ? 'TRANSPARENT' : `BG ${backdrop.color.toString(16)}`;
    await drawFooterBar(canvas, `AI MATTING ${label} ${target.w}x${target.h}`);
    /*
     * 透明底必须出 PNG: JPEG 没有 alpha 通道, 抠掉的部分会被压成实色,
     * 用户拿到的图与「透明背景」的承诺不符。此前只有「尺寸未变」才走 PNG,
     * 一旦选了非 original 比例就静默丢透明度。
     */
    if (backdrop.kind === 'transparent' || backdrop.alpha < 255) {
      return { kind: 'image' as const, buffer: await canvas.getBuffer(JimpMime.png), format: 'image/png' };
    }
    return { kind: 'image' as const, buffer: await canvas.getBuffer(JimpMime.jpeg), format: 'image/jpeg' };
  }

  // ── real: 智能扩图 (原图占比 + 位置 + 边缘延展) ──
  private async makeExpand(inputPaths: string[], params: Record<string, any>) {
    const inputPath = requireInput(inputPaths, 'expand');
    const src = await Jimp.read(inputPath);
    const sw = src.bitmap.width;
    const sh = src.bitmap.height;
    const occupy = clampInt(Math.round(Number(params.occupy) || 80), 1, 99);

    /*
     * 参考站 SMART_EXPAND 的构图语义 (2026-10-25 对齐):
     *   scale = min(canvasW / srcW, canvasH / srcH) * occupy / 100
     * 即「原图占比」是原图在一个轴向上的线性占比，不是旧的面积占比。
     *
     * 本地不把源图重采样到更小再放大，而是让最小边恰好保留原像素：
     * 先按目标画幅求出能完整容纳源图的基础画布，再整体除以占比。
     */
    const ratioKey =
      wasProvided(params, 'targetImageRatio') && params.targetImageRatio
        ? String(params.targetImageRatio)
        : params.ratio;
    const ratioH = ratioKey && ratioKey !== 'original' ? parseRatio(ratioKey, sh / sw) : sh / sw;
    const share = occupy / 100;
    const sourceAspect = sw / sh;
    let W: number;
    let H: number;
    if (sourceAspect >= 1 / ratioH) {
      // 源图比目标画幅更宽：宽度是限制边
      W = Math.max(sw + 2, Math.round(sw / share));
      H = Math.max(sh + 2, Math.round(W * ratioH));
    } else {
      // 源图比目标画幅更高：高度是限制边
      H = Math.max(sh + 2, Math.round(sh / share));
      W = Math.max(sw + 2, Math.round(H / ratioH));
    }

    // 本地长边上限: 保持构图不变，对画布与放置尺寸按同一比例缩放。
    const cap = Math.min(1, LOCAL_MAX_SIDE / Math.max(W, H));
    W = Math.max(sw + 2, Math.round(W * cap));
    H = Math.max(sh + 2, Math.round(H * cap));

    // 用 min 保留源图比例，避免非原比例时被拉伸。
    const fitScale = Math.min(W / sw, H / sh) * share;
    let placeW = Math.max(1, Math.round(sw * fitScale));
    let placeH = Math.max(1, Math.round(sh * fitScale));

    const placementProvided =
      wasProvided(params, 'placementWidth') && wasProvided(params, 'placementHeight');
    if (placementProvided) {
      const pw = clampNum(Number(params.placementWidth), 0.01, 1);
      const ph = clampNum(Number(params.placementHeight), 0.01, 1);
      placeW = Math.max(1, Math.round(W * pw));
      placeH = Math.max(1, Math.round(H * ph));
    }

    /*
     * 原图在画布中的位置: 精确 placement 优先，否则九宫格 (center 默认居中)。
     * 参考站的 placementX/Y 是**源图左上角相对目标画布**的归一化坐标
     * (浏览器端直接 `x / canvasWidth`)；不是「剩余空白区域的百分比」。
     * 用后者会把 x=0.25 画到 0.125 的位置，只有 0/0.5/1 碰巧一致。
     */
    const pos = EXPAND_POSITION_BOX[String(params.position)] ?? EXPAND_POSITION_BOX.center;
    const offX = wasProvided(params, 'placementX')
      ? clampInt(Math.round(clampNum(Number(params.placementX), 0, 1) * W), 0, Math.max(0, W - placeW))
      : Math.round((W - placeW) * pos.fx);
    const offY = wasProvided(params, 'placementY')
      ? clampInt(Math.round(clampNum(Number(params.placementY), 0, 1) * H), 0, Math.max(0, H - placeH))
      : Math.round((H - placeH) * pos.fy);

    const canvas = new Jimp({ width: W, height: H, color: 0xffffffff });

    // 边缘延展: 逐像素从原图最近边界取样，模拟内容补全 (纯色/渐变背景效果自然)
    const { data: sd } = src.bitmap;
    const { data: cd } = canvas.bitmap;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const inside = x >= offX && x < offX + placeW && y >= offY && y < offY + placeH;
        const relX = inside
          ? ((x - offX) / Math.max(placeW, 1)) * sw
          : ((clampInt(x - offX, 0, placeW - 1) / Math.max(placeW, 1)) * sw);
        const relY = inside
          ? ((y - offY) / Math.max(placeH, 1)) * sh
          : ((clampInt(y - offY, 0, placeH - 1) / Math.max(placeH, 1)) * sh);
        const sx = clampInt(Math.round(relX), 0, sw - 1);
        const sy = clampInt(Math.round(relY), 0, sh - 1);
        const si = (sy * sw + sx) * 4;
        const di = (y * W + x) * 4;
        cd[di] = sd[si];
        cd[di + 1] = sd[si + 1];
        cd[di + 2] = sd[si + 2];
        cd[di + 3] = 255;
      }
    }

    // 羽化: 在原图边界外做一圈渐变过渡, 减轻拼接感 (固定 8px, 参考站该页无此控件)
    applyFeather(canvas, offX, offY, placeW, placeH, 8);

    await drawFooterBar(
      canvas,
      `AI EXPAND occupy ${occupy}% pos ${params.position} place ${Math.round((placeW / W) * 100)}% ${W}x${H}`,
    );
    return { kind: 'image' as const, buffer: await canvas.getBuffer(JimpMime.jpeg), format: 'image/jpeg' };
  }

  // ── real: 旋转角度 (yaw 水平旋转 + pitch 俯仰剪切 + zoom 缩放, 2D 近似) ──
  private async makeRotate(inputPaths: string[], params: Record<string, any>) {
    const inputPath = requireInput(inputPaths, 'rotate');
    const src = await Jimp.read(inputPath);
    /*
     * 同时收到新旧字段时以旧字段为准：页面的 yaw/pitch/zoom 是用户在预览里
     * 实际看到的方向，而 azimuthDeg 在参考站主体模式下使用相机坐标系（符号
     * 相反）。本地 2D 算法不能把预览方向悄悄反过来；仅传参考站字段时仍以其
     * 为兜底，保证 API 兼容。
     */
    const rawYaw = wasProvided(params, 'yaw')
      ? Number(params.yaw) || 0
      : wasProvided(params, 'azimuthDeg')
        ? Number(params.azimuthDeg) || 0
        : 0;
    const rawPitch = wasProvided(params, 'pitch')
      ? Number(params.pitch) || 0
      : wasProvided(params, 'elevationDeg')
        ? Number(params.elevationDeg) || 0
        : 0;
    const rawZoom = wasProvided(params, 'zoom')
      ? Number(params.zoom) || 1
      : wasProvided(params, 'zoomFactor')
        ? Number(params.zoomFactor) || 1
        : 1;
    const yaw = clampNum(rawYaw, -90, 90);
    const pitch = clampNum(rawPitch, -30, 60);
    const zoom = clampNum(rawZoom, 0.8, 1.2);

    // 目标画布: 原比例保持源尺寸; 指定比例按该比例生成 (仅缩小不放大, 长边上限 2048)
    const ratio =
      wasProvided(params, 'imageRatio') && params.imageRatio ? String(params.imageRatio) : params.ratio;
    const target = outputSizeFor(src.bitmap.width, src.bitmap.height, ratio, 2048);
    const canvas = new Jimp({ width: target.w, height: target.h, color: 0xffffffff });

    /*
     * zoom: 以「源图 contain 进目标画布」为 1.0 基准，再乘缩放系数。
     * 这里不能再调用 fitInside(源图×zoom)：它会把放大后的尺寸重新 contain
     * 回画布，1.2 被 1/1.2 抵消，滑杆看起来有效但像素完全没变。
     */
    const baseScale = Math.min(target.w / src.bitmap.width, target.h / src.bitmap.height);
    const workW = Math.max(1, Math.round(src.bitmap.width * baseScale * zoom));
    const workH = Math.max(1, Math.round(src.bitmap.height * baseScale * zoom));
    let work = src.clone().resize({ w: workW, h: workH });

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

    /*
     * zoom > 1 时 work 会超出画布，先居中裁掉溢出部分再合成。
     * Jimp composite 不接受负坐标（会直接跳过负区域），不能靠偏移实现裁切。
     */
    const cropW = Math.min(work.bitmap.width, target.w);
    const cropH = Math.min(work.bitmap.height, target.h);
    if (work.bitmap.width > target.w || work.bitmap.height > target.h) {
      work = work.crop({
        x: Math.max(0, Math.round((work.bitmap.width - target.w) / 2)),
        y: Math.max(0, Math.round((work.bitmap.height - target.h) / 2)),
        w: cropW,
        h: cropH,
      });
    }
    canvas.composite(work, Math.round((target.w - work.bitmap.width) / 2), Math.round((target.h - work.bitmap.height) / 2));
    await drawFooterBar(canvas, `AI VIEW yaw ${yaw} pitch ${pitch} zoom ${zoom} ${target.w}x${target.h}`);
    return { kind: 'image' as const, buffer: await canvas.getBuffer(JimpMime.jpeg), format: 'image/jpeg' };
  }

  // ── real: 商品换色 (保明度换色相; 目标色取自参考站色板或自定义 HEX) ──
  private async makeRecolor(inputPaths: string[], params: Record<string, any>) {
    const inputPath = requireInput(inputPaths, 'recolor');
    const img = await Jimp.read(inputPath);
    /*
     * 参考站 PRODUCT_RECOLOR 直接提交 targetColor (最终解析后的 HEX)；
     * 旧页面仍提交 color/customColor。存在 targetColor 时不再看旧字段，
     * 避免 sanitize 的默认白底把用户选中的颜色悄悄覆盖。
     */
    const colorKey = wasProvided(params, 'targetColor')
      ? String(params.targetColor ?? '')
      : String(params.color ?? '#FFFFFF');
    const targetHex =
      !wasProvided(params, 'targetColor') && colorKey === 'custom'
        ? String(params.customColor ?? '')
        : colorKey;
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

    const tag = targetHex;
    await drawFooterBar(img, `AI RECOLOR ${tag} (${replaced}px)`);
    return { kind: 'image' as const, buffer: await img.getBuffer(JimpMime.jpeg), format: 'image/jpeg' };
  }

  // ── real: 产品精修 (6 模式像素管线 + 补充要求记录) ──
  private async makeEnhance(inputPaths: string[], params: Record<string, any>) {
    const inputPath = requireInput(inputPaths, 'enhance');
    const src = await Jimp.read(inputPath);
    const mode = RETOUCH_TEMPLATE_TO_MODE[String(params.templateCode ?? '')] ?? String(params.mode ?? 'comprehensive');
    const m = RETOUCH_PIPELINE[mode] ?? RETOUCH_PIPELINE.comprehensive;

    // 画布: 原比例保持源尺寸 (仅缩小不放大), 指定比例按该比例适配
    const ratio =
      wasProvided(params, 'imageRatio') && params.imageRatio ? String(params.imageRatio) : params.ratio;
    const target = outputSizeFor(src.bitmap.width, src.bitmap.height, ratio, 2048);
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
    const note = asciiOnly(params.additionalRequirement ?? params.note, 60);
    if (note) await printText(img, `NOTE: ${note}`, 16, 16, 'black');
    await drawFooterBar(img, `AI RETOUCH mode=${mode} ${target.w}x${target.h}`);
    return { kind: 'image' as const, buffer: await img.getBuffer(JimpMime.jpeg), format: 'image/jpeg' };
  }

  // ── real: 多图融合 (场景版式 + 真实图片层叠; 非 AI 语义融合) ──
  private async makeMultiFusion(inputPaths: string[], params: Record<string, any>) {
    const paths = inputPaths.filter(Boolean);
    if (paths.length < 2) throw new Error('multi_fusion 需要主体图与搭配图');
    const subject = await Jimp.read(paths[0]);
    const accents = await Promise.all(paths.slice(1, 6).map((p) => Jimp.read(p)));

    const size = localOutputSide('multi_fusion', params);
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

    await drawFooterBar(sheet, `MULTI FUSION scene ${scene} variants ${variantCount} ${W}x${H}`);
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

  // ── real: 商品SKU图 (模板合成: 商品排版 + 色卡 + 规格表 + 变体条) ──
  /**
   * SKU 套版。
   *
   * 早期实现只是"原图铺满 + 一块半透明色块", 那是占位而非出图 —— 运营拿到的
   * 东西不能直接用于店铺。现在按电商 SKU 图的真实版式合成:
   *
   *   ┌──────────────────────────┐
   *   │  SKU TEMPLATE            │ ← 标题条
   *   │        [ 商品图 ]        │ ← 按 region 摆放, contain 不裁切主体
   *   │  ▢ 色卡  #RRGGBB          │ ← 颜色方块 + 十六进制值
   *   │  SKU  / COLOR / SIZE / QTY│ ← 规格表 (值来自本次参数, 不是写死)
   *   │  ■ ■ ■                    │ ← 变体条: 基色 + 提亮 + 压暗
   *   └──────────────────────────┘
   *
   * 仍然是**确定性算法**而非生成模型: 版式、品牌色、字号都由代码决定。
   * 与云端通道的差别只在"商品图不会被重绘", 该给的套版能力已经给到。
   */
  private async makeSkuImage(inputPaths: string[], params: Record<string, any>) {
    const inputPath = requireInput(inputPaths, 'sku_image');
    const src = await Jimp.read(inputPath);
    const size = localOutputSide('sku_image', params);
    const ratioH = parseRatio(params.ratio, 1);
    const W = size;
    const H = Math.max(64, Math.round(size * ratioH));
    const pad = Math.round(W * 0.05);
    const headH = Math.round(H * 0.09);
    const footH = Math.round(H * 0.34);

    // 新链路有真实框选坐标: 保留整张模板, 只在框内叠加当前 SKU 的变体信息。
    const regions = parseSkuRegions(params.regions);
    if (regions.length > 0) {
      return this.makeSkuRegionComposite(src, W, H, regions, params);
    }

    const canvas = new Jimp({ width: W, height: H, color: 0xffffffff });

    // 标题条: 品牌紫细条 + 左对齐标题 (Jimp 无中文字体, 用 ASCII 版式名)
    const bar = new Jimp({ width: W, height: headH, color: 0x5546d8ff });
    canvas.composite(bar, 0, 0);
    await printText(canvas, 'SKU TEMPLATE', pad, Math.round(headH * 0.28), 'white');

    /*
     * 商品区: region 决定商品图落在标题与规格区之间的哪个位置。
     *
     * ⚠️ 水平与垂直**都必须生效**。此前只用了 fx/fw 而把 stageY 写死，
     * 于是「画面上方」与「画面下方」渲染出完全相同的图 —— 用户改了参数却
     * 看不出任何变化，这是最难察觉的一类功能缺失。这里按 fy/fh 在内容带内
     * 归一化定位，五个 region 各自的产出都能区分开。
     */
    const contentY = headH + pad;
    const contentH = Math.max(64, H - headH - footH - pad * 2);
    const rel = SKU_REGION_BOX[params.region] ?? SKU_REGION_BOX.center;
    const stageW = Math.round(W * Math.min(0.72, Math.max(0.24, rel.fw)));
    const stageX = clampInt(Math.round(W * rel.fx + (W * rel.fw - stageW) / 2), pad, W - stageW - pad);
    const stageH = Math.max(48, Math.round(contentH * Math.min(0.8, rel.fh)));
    // fy 的取值域是 [0.08, 0.62]：归一化到 0..1 后再分配到剩余垂直空间，
    // 直接乘会全部挤在内容带上半部分，上方/下方就只剩几像素差别。
    const fyMin = Math.min(...Object.values(SKU_REGION_BOX).map((b) => b.fy));
    const fyMax = Math.max(...Object.values(SKU_REGION_BOX).map((b) => b.fy));
    const fyRatio = fyMax > fyMin ? (rel.fy - fyMin) / (fyMax - fyMin) : 0.5;
    const stageY = clampInt(
      Math.round(contentY + (contentH - stageH) * fyRatio),
      contentY,
      contentY + contentH - stageH,
    );
    const boxSide = Math.min(stageW, stageH);
    const product = src.clone().contain({ w: boxSide, h: boxSide });
    canvas.composite(product, stageX + Math.round((stageW - boxSide) / 2), stageY + Math.round((stageH - boxSide) / 2));
    drawRectBorder(canvas, stageX, stageY, stageW, stageH, Math.max(2, Math.round(W / 512)), 0xe5e7efff);

    // 规格区: 色卡 + 表格 + 变体条
    const footY = H - footH;
    const hex = resolveSkuColor(params).toUpperCase();
    const rgb = hexToRgb(hex);
    const chip = Math.round(W * 0.07);
    const chipX = pad;
    const chipY = footY + Math.round(footH * 0.14);
    canvas.composite(new Jimp({ width: chip, height: chip, color: rgbaToInt(rgb.r, rgb.g, rgb.b, 255) }), chipX, chipY);
    drawRectBorder(canvas, chipX, chipY, chip, chip, Math.max(2, Math.round(W / 512)), 0x171a2bff);

    const labelX = chipX + chip + Math.round(W * 0.03);
    await printText(canvas, `COLOR ${hex}`, labelX, chipY, 'black');
    const sku = asciiOnly(params.skuName, 32);
    const rows: Array<[string, string]> = [
      ['SKU', sku || 'CLASSIC-BLACK-M'],
      ['SIZE', `${W}x${H} / ${String(params.ratio ?? '1:1')}`],
      ['QTY', '1 PCS'],
    ];
    const rowH = Math.round(chip / rows.length + 6);
    rows.forEach(([k, v], i) => {
      const ry = chipY + i * rowH;
      void printText(canvas, `${k}: ${v}`, labelX, ry, 'black');
    });

    // 变体条: 基色 + 提亮 + 压暗 (同一 SKU 的明度梯度, 供运营判断配色方向)
    const sw = Math.round(W * 0.035);
    const variants = [1, 1.18, 0.8].map((f) =>
      rgbaToInt(
        clampInt(Math.round(rgb.r * f), 0, 255),
        clampInt(Math.round(rgb.g * f), 0, 255),
        clampInt(Math.round(rgb.b * f), 0, 255),
        255,
      ),
    );
    variants.forEach((c, i) => {
      const sx = W - pad - (variants.length - i) * (sw + Math.round(W * 0.012));
      canvas.composite(new Jimp({ width: sw, height: sw, color: c }), sx, chipY);
      drawRectBorder(canvas, sx, chipY, sw, sw, Math.max(1, Math.round(W / 1024)), 0x86909cff);
    });

    await drawFooterBar(canvas, `SKU TEMPLATE region ${params.region} ${W}x${H}`);
    return { kind: 'image' as const, buffer: await canvas.getBuffer(JimpMime.jpeg), format: 'image/jpeg' };
  }

  /**
   * 框选版 SKU 合成 (本地兜底)。
   *
   * 与上方固定版式的区别: 这里**不重排模板**, 而是把原模板按比例放进输出画布,
   * 再把前端框选的归一化坐标映射到实际像素, 在框内叠加当前 SKU 的颜色与名称。
   * 因此用户换了框选位置, 本地产出也会跟着变; 区域数量/位置不再被枚举吞掉。
   */
  private async makeSkuRegionComposite(
    src: Img,
    W: number,
    H: number,
    regions: SkuRegionBox[],
    params: Record<string, any>,
  ): Promise<ImageProviderResult> {
    const canvas = new Jimp({ width: W, height: H, color: 0xffffffff });
    const scale = Math.min(W / src.bitmap.width, H / src.bitmap.height);
    const drawW = Math.max(1, Math.round(src.bitmap.width * scale));
    const drawH = Math.max(1, Math.round(src.bitmap.height * scale));
    const offX = Math.round((W - drawW) / 2);
    const offY = Math.round((H - drawH) / 2);
    canvas.composite(src.clone().resize({ w: drawW, h: drawH }), offX, offY);

    const hex = resolveSkuColor(params).toUpperCase();
    const rgb = hexToRgb(hex);
    const sku = asciiOnly(params.skuName, 32) || 'CLASSIC-BLACK-M';
    const fontPx = W >= 1600 ? 64 : 32;
    const border = Math.max(2, Math.round(W / 512));

    for (const [index, region] of regions.entries()) {
      const x = clampInt(Math.round(offX + region.x * drawW), 0, W - 1);
      const y = clampInt(Math.round(offY + region.y * drawH), 0, H - 1);
      const w = Math.max(2, Math.min(W - x, Math.round(region.width * drawW)));
      const h = Math.max(2, Math.min(H - y, Math.round(region.height * drawH)));

      // 半透明 SKU 色块: 既保留模板细节, 又让框选位置对产出可见。
      canvas.composite(
        new Jimp({ width: w, height: h, color: rgbaToInt(rgb.r, rgb.g, rgb.b, 64) }),
        x,
        y,
      );
      drawRectBorder(canvas, x, y, w, h, border, 0x5546d8ff);

      // 角标 (1/2/3) 证明该区域确实参与合成; 区域太小则只画框。
      const badge = fontPx + 8;
      if (w >= badge && h >= badge) {
        canvas.composite(new Jimp({ width: badge, height: badge, color: 0x5546d8ff }), x, y);
        await printText(canvas, String(index + 1), x + 4, y + 1, 'white');
      }

      // 只在空间足够的区域写入 SKU 名称; 避免大字号文字溢出框外。
      const labelW = w - badge - 12;
      const maxChars = Math.max(0, Math.floor(labelW / (fontPx * 0.6)));
      if (maxChars >= 4 && h >= fontPx + 10) {
        const labelBg = new Jimp({ width: labelW, height: fontPx + 8, color: 0xffffffee });
        canvas.composite(labelBg, x + badge, y);
        await printText(canvas, sku.slice(0, Math.min(32, maxChars)), x + badge + 6, y + 2, 'black');
      }
    }

    await drawFooterBar(
      canvas,
      `SKU ${sku} | ${hex} | ${regions.length}R | ${W}x${H}`,
    );
    return { kind: 'image' as const, buffer: await canvas.getBuffer(JimpMime.jpeg), format: 'image/jpeg' };
  }

  // ── real: 去除水印 (镜像修补 + 羽化融合, 非 AI) ──
  /**
   * 本地去水印。
   *
   * 算法是**镜像修补 + 羽化融合**，不是 AI 重绘：
   *   1. 按参数圈定水印框（自动模式落在右下角，水印最常见的落点）；
   *   2. 从画面另一侧镜像取一块像素盖上去 —— 电商图的水印底下通常是
   *      纯色底或渐变底，镜像块与周围同源，比"用周围均值涂平"更不容易糊成一块；
   *   3. 做完均值匹配（把镜像块的整体亮度/色偏对齐到框外环的平均色），
   *      否则左右两侧曝光不同的图会在接缝处出现明显色块；
   *   4. 边缘按距离羽化过渡，内部做一次 3x3 平滑压掉镜像出来的重复纹理。
   *
   * 能力边界（别在文案里含糊）：这**去不掉压在商品主体上的水印**。真正压在
   * 主体细节上的水印需要生成式重绘，本地做不到 —— 那种情况应该走云端通道。
   */
  private async makeRemoveWatermark(inputPaths: string[], params: Record<string, any>, maskPath?: string) {
    const inputPath = requireInput(inputPaths, 'remove_watermark');
    const img = await Jimp.read(inputPath);
    const requestedFormat = String(params.outputFormat ?? '').toUpperCase();
    const outputFormat = requestedFormat === 'PNG' ? 'image/png' : 'image/jpeg';
    const encode = async () => ({
      kind: 'image' as const,
      buffer:
        outputFormat === 'image/png'
          ? await img.getBuffer(JimpMime.png)
          : await img.getBuffer(JimpMime.jpeg),
      format: outputFormat,
    });

    /*
     * 手动遮罩优先 (2026-10-25)。前端画布的遮罩语义与局部重绘一致:
     * 白色/不透明 = 保留，透明 = 去除。只要存在可用的透明像素，就完全按
     * 用户标注修补，不再退化成固定角落框 —— 后者会把框内正常画面一起抹掉。
     */
    if (maskPath) {
      try {
        const mask = await Jimp.read(maskPath);
        const covered = inpaintMaskedRegion(img.bitmap, mask.bitmap);
        if (covered > 0) {
          await drawFooterBar(
            img,
            `WATERMARK REMOVED (masked-inpaint ${covered}px) ${img.bitmap.width}x${img.bitmap.height}`,
          );
          return encode();
        }
      } catch (e) {
        // 遮罩损坏不应让整个任务失败: 自动/区域模式仍是真实算法，但要留下日志
        log.warn(`remove_watermark 遮罩读取失败, 回落到 ${String(params.mode ?? 'auto')} 模式 — ${(e as Error).message}`);
      }
    }

    /*
     * 自动识别 (默认) 与指定区域必须真的走不同分支 —— 此前 mode 只进页脚文案,
     * 两种模式固定用右下角 34%×12% 的框, 水印不在右下角时等于没处理。
     */
    /*
     * 页面在“自动/指定区域”两种非手动模式下都会提交 detectionMode=AUTO，
     * 因此不能反过来用它覆盖明确选中的 mode —— 否则用户选了“左上角”仍会
     * 落到自动识别。detectionMode 只在旧调用方没给 mode 时作为兜底；
     * 两者都缺省时保持旧行为的自动识别，而不是误落到固定区域。
     */
    const mode = String(params.mode ?? (params.detectionMode === 'MANUAL' ? 'region' : 'auto'));
    const detected = mode === 'auto' ? detectWatermarkRegion(img.bitmap) : null;
    const region = detected ? detected.region : String(params.region ?? 'bottom_right');
    const box = watermarkBox(region, img.bitmap.width, img.bitmap.height);

    const method = inpaintRegion(img.bitmap, box);
    const regionLabel = detected
      ? `${region}${detected.confident ? '' : ' (FALLBACK)'}`
      : region;
    await drawFooterBar(
      img,
      `WATERMARK REMOVED (${method}) region ${regionLabel} ${img.bitmap.width}x${img.bitmap.height}`,
    );
    return encode();
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

/** 参考站 PRODUCT_REFINEMENT 模板码 → 本地像素管线键 */
const RETOUCH_TEMPLATE_TO_MODE: Record<string, string> = {
  IT_PR_COMPREHENSIVE: 'comprehensive',
  IT_PR_TEXTURE: 'texture',
  IT_PR_DEFECT_REPAIR: 'blemish',
  IT_PR_COLOR_CORRECTION: 'color',
  IT_PR_CLARITY: 'clarity',
  IT_PR_MATERIAL: 'material',
};


/** SKU 变体区域 → 模板相对坐标 (参考站为框选, 本地以位置枚举代替) */
const SKU_REGION_BOX: Record<string, { fx: number; fy: number; fw: number; fh: number }> = {
  center: { fx: 0.2, fy: 0.2, fw: 0.6, fh: 0.6 },
  top: { fx: 0.2, fy: 0.08, fw: 0.6, fh: 0.3 },
  bottom: { fx: 0.2, fy: 0.62, fw: 0.6, fh: 0.3 },
  left: { fx: 0.06, fy: 0.2, fw: 0.3, fh: 0.6 },
  right: { fx: 0.64, fy: 0.2, fw: 0.3, fh: 0.6 },
};


/** 水印框: 相对画面尺寸的固定比例 (水印通常是角落上一小块, 不是整条边) */
function watermarkBox(region: string, W: number, H: number) {
  const bw = Math.round(W * 0.34);
  const bh = Math.round(H * 0.12);
  const pad = Math.round(Math.min(W, H) * 0.03);
  const map: Record<string, { x: number; y: number }> = {
    bottom_right: { x: W - bw - pad, y: H - bh - pad },
    bottom_left: { x: pad, y: H - bh - pad },
    top_right: { x: W - bw - pad, y: pad },
    top_left: { x: pad, y: pad },
    center: { x: Math.round((W - bw) / 2), y: Math.round((H - bh) / 2) },
  };
  const at = map[region] ?? map.bottom_right;
  return { x: Math.max(0, at.x), y: Math.max(0, at.y), w: Math.min(bw, W), h: Math.min(bh, H) };
}

/**
 * 按像素遮罩修补 (2026-10-25)。
 *
 * 输入遮罩与局部重绘共用约定: 透明 = 要去除, 不透明 = 保留。为了兼容
 * 直传的黑白遮罩，另外把「不透明且接近黑色」也视作去除区域。
 *
 * 算法不是把整块矩形镜像回来，而是只处理用户真正圈出的像素：
 *   1. 以遮罩边界外的一圈真实像素为种子，做多源 BFS，把最近边界颜色向
 *      遮罩内部扩散 —— 任意形状（画笔/框选/圈选）都能处理；
 *   2. 用遮罩外环均值做整体色偏修正，避免接缝处出现一块明显色差；
 *   3. 仅在遮罩内部做 3x3 平滑，压掉扩散产生的条纹。
 *
 * 返回实际修补像素数；0 表示遮罩里没有可处理区域（调用方回落自动模式）。
 */
function inpaintMaskedRegion(
  bmp: { data: Buffer; width: number; height: number },
  maskBmp: { data: Buffer; width: number; height: number },
): number {
  const { data, width: W, height: H } = bmp;
  const mw = maskBmp.width;
  const mh = maskBmp.height;
  if (!mw || !mh) return 0;

  const total = W * H;
  const target = new Uint8Array(total);
  let minX = W;
  let minY = H;
  let maxX = -1;
  let maxY = -1;
  let count = 0;
  for (let y = 0; y < H; y++) {
    const my = Math.min(mh - 1, Math.floor((y / H) * mh));
    for (let x = 0; x < W; x++) {
      const mx = Math.min(mw - 1, Math.floor((x / W) * mw));
      const mi = (my * mw + mx) * 4;
      const a = maskBmp.data[mi + 3];
      const lum = (maskBmp.data[mi] + maskBmp.data[mi + 1] + maskBmp.data[mi + 2]) / 3;
      if (a < 128 || (a >= 128 && lum < 96)) {
        target[y * W + x] = 1;
        count++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (count < 4 || maxX < minX || maxY < minY) return 0;

  const pad = 4;
  const x0 = Math.max(0, minX - pad);
  const y0 = Math.max(0, minY - pad);
  const x1 = Math.min(W - 1, maxX + pad);
  const y1 = Math.min(H - 1, maxY + pad);
  const bw = x1 - x0 + 1;
  const bh = y1 - y0 + 1;
  const area = bw * bh;
  const filled = new Uint8Array(area);
  const queue = new Int32Array(area);
  let head = 0;
  let tail = 0;

  const localIndex = (x: number, y: number) => (y - y0) * bw + (x - x0);
  const at = (x: number, y: number) => (y * W + x) * 4;

  // 种子: 贴着遮罩边界的外侧真实像素
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (target[y * W + x]) continue;
      const touchesMask =
        (x > x0 && target[y * W + x - 1]) ||
        (x < x1 && target[y * W + x + 1]) ||
        (y > y0 && target[(y - 1) * W + x]) ||
        (y < y1 && target[(y + 1) * W + x]);
      if (!touchesMask) continue;
      const li = localIndex(x, y);
      filled[li] = 1;
      queue[tail++] = li;
    }
  }

  /*
   * 多源 BFS: 每个种子携带自己的颜色，向四邻扩散。只读原始缓冲，
   * 因此不会把刚写入的混合色再复制出去（否则会形成明显拖尾）。
   */
  const original = Buffer.from(data);
  while (head < tail) {
    const li = queue[head++];
    const lx = li % bw;
    const ly = Math.floor(li / bw);
    const x = lx + x0;
    const y = ly + y0;
    const si = at(x, y);
    const neighbors: Array<[number, number]> = [
      [x - 1, y],
      [x + 1, y],
      [x, y - 1],
      [x, y + 1],
    ];
    for (const [nx, ny] of neighbors) {
      if (nx < x0 || nx > x1 || ny < y0 || ny > y1) continue;
      const di = ny * W + nx;
      if (!target[di]) continue;
      const nli = localIndex(nx, ny);
      if (filled[nli]) continue;
      const out = at(nx, ny);
      data[out] = original[si];
      data[out + 1] = original[si + 1];
      data[out + 2] = original[si + 2];
      filled[nli] = 1;
      queue[tail++] = nli;
    }
  }

  // 色偏修正: 用遮罩外环与修补块均值对齐（限制 ±24，避免整体过曝/偏色）
  let ringR = 0;
  let ringG = 0;
  let ringB = 0;
  let ringN = 0;
  let fillR = 0;
  let fillG = 0;
  let fillB = 0;
  let fillN = 0;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = at(x, y);
      if (target[y * W + x]) {
        fillR += data[i];
        fillG += data[i + 1];
        fillB += data[i + 2];
        fillN++;
      } else {
        ringR += data[i];
        ringG += data[i + 1];
        ringB += data[i + 2];
        ringN++;
      }
    }
  }
  const shift = [0, 1, 2].map((c) => {
    if (!ringN || !fillN) return 0;
    const ring = [ringR, ringG, ringB][c] / ringN;
    const fill = [fillR, fillG, fillB][c] / fillN;
    return clampInt(Math.round(ring - fill), -24, 24);
  });

  // 只在遮罩内部平滑，保留用户标注意外的原始像素与边界过渡
  const smooth = Buffer.from(data);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (!target[y * W + x]) continue;
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const ni = (ny * W + nx) * 4;
          r += smooth[ni];
          g += smooth[ni + 1];
          b += smooth[ni + 2];
          n++;
        }
      }
      if (!n) continue;
      const di = at(x, y);
      data[di] = clampInt(Math.round(r / n + shift[0]), 0, 255);
      data[di + 1] = clampInt(Math.round(g / n + shift[1]), 0, 255);
      data[di + 2] = clampInt(Math.round(b / n + shift[2]), 0, 255);
    }
  }

  return count;
}

/**
 * 自动识别水印区域 (启发式, 不做语义识别)。
 *
 * 水印通常是一层半透明文字/logo, 叠加处的局部边缘密度明显高于同画面其他角落。
 * 对 5 个候选框算梯度能量并取最高者; 若最高与次高差距不足 (画面本身细节丰富、
 * 没有明显叠加物), 回落右下角并在页脚标 `(FALLBACK)` —— 宁可按最常见位置处理,
 * 也不假装「识别到了」。
 *
 * 局限: 只做单帧像素统计。商品纹理复杂、水印很淡或水印压在主体中间时可能判错,
 * 需要精确控制时应选「指定区域」并手选位置。
 */
function detectWatermarkRegion(bitmap: {
  width: number;
  height: number;
  data: Buffer | Uint8Array;
}): { region: string; confident: boolean } {
  const candidates = ['bottom_right', 'bottom_left', 'top_right', 'top_left', 'center'];
  const scores = candidates
    .map((region) => ({ region, score: edgeEnergy(bitmap, watermarkBox(region, bitmap.width, bitmap.height)) }))
    .sort((a, b) => b.score - a.score);

  const best = scores[0];
  const second = scores[1];
  // 差距 < 25% 视为「没有明显优于其他区域」, 不宣称识别成功
  const confident = !second || second.score <= 0 || best.score >= second.score * 1.25;
  return confident ? { region: best.region, confident: true } : { region: 'bottom_right', confident: false };
}

/** 候选框内的平均梯度能量 (相邻像素亮度差绝对值之和 / 采样点数) */
function edgeEnergy(
  bitmap: { width: number; height: number; data: Buffer | Uint8Array },
  box: { x: number; y: number; w: number; h: number },
): number {
  const { data, width } = bitmap;
  const lum = (x: number, y: number): number => {
    const i = (y * width + x) * 4;
    // 整数亮度近似 (0.299R + 0.587G + 0.114B), 避免每像素浮点乘法的开销
    return (data[i] * 77 + data[i + 1] * 150 + data[i + 2] * 29) >> 8;
  };
  let sum = 0;
  let n = 0;
  for (let y = box.y; y < box.y + box.h - 1; y += 2) {
    for (let x = box.x; x < box.x + box.w - 1; x += 2) {
      sum += Math.abs(lum(x, y) - lum(x + 1, y)) + Math.abs(lum(x, y) - lum(x, y + 1));
      n += 2;
    }
  }
  return n === 0 ? 0 : sum / n;
}

/**
 * 镜像修补。返回实际使用的方法名, 写进页脚便于事后核对 (纯排障用)。
 *
 * 选镜像方向的规则: 优先水平镜像, 因为电商图左右两侧的背景通常一致
 * (纯色/渐变), 而上下往往一个是地面一个是天空。水平镜像块与目标框重叠时
 * 退到垂直镜像; 两者都重叠 (框几乎占满画面) 时退到「边框均值扩散」——
 * 那种情况下任何镜像都会把水印自己复制回来。
 */
function inpaintRegion(
  bmp: { data: Buffer; width: number; height: number },
  box: { x: number; y: number; w: number; h: number },
): string {
  const { data, width: W, height: H } = bmp;
  const { x, y, w, h } = box;
  if (w <= 0 || h <= 0) return 'noop';

  const intersects = (a: { x: number; y: number; w: number; h: number }) =>
    a.x < x + w && a.x + a.w > x && a.y < y + h && a.y + a.h > y;

  const mirrorX = { x: W - (x + w), y, w, h };
  const mirrorY = { x, y: H - (y + h), w, h };
  let method: 'mirror-x' | 'mirror-y' | 'diffuse';
  let src: (px: number, py: number) => { x: number; y: number };
  if (!intersects(mirrorX) && mirrorX.x >= 0) {
    method = 'mirror-x';
    src = (px) => ({ x: W - 1 - px, y: 0 });
  } else if (!intersects(mirrorY) && mirrorY.y >= 0) {
    method = 'mirror-y';
    src = (px, py) => ({ x: px, y: H - 1 - py });
  } else {
    method = 'diffuse';
    src = () => ({ x: 0, y: 0 });
  }

  const at = (px: number, py: number) => (py * W + px) * 4;

  // 1. 框外环均值 (取 2px 宽的一圈), 用于色彩匹配
  let ringR = 0;
  let ringG = 0;
  let ringB = 0;
  let ringN = 0;
  for (let py = Math.max(0, y - 2); py < Math.min(H, y + h + 2); py++) {
    for (let px = Math.max(0, x - 2); px < Math.min(W, x + w + 2); px++) {
      const inside = px >= x && px < x + w && py >= y && py < y + h;
      if (inside) continue;
      const i = at(px, py);
      ringR += data[i];
      ringG += data[i + 1];
      ringB += data[i + 2];
      ringN++;
    }
  }

  // 2. 逐像素写入镜像块
  if (method !== 'diffuse') {
    let patchR = 0;
    let patchG = 0;
    let patchB = 0;
    for (let py = y; py < y + h; py++) {
      for (let px = x; px < x + w; px++) {
        const s0 = src(px, py);
        const i = at(s0.x, s0.y);
        patchR += data[i];
        patchG += data[i + 1];
        patchB += data[i + 2];
      }
    }
    const n = w * h;
    const shift = [0, 1, 2].map((c) => {
      if (ringN === 0) return 0;
      const ring = [ringR, ringG, ringB][c] / ringN;
      const patch = [patchR, patchG, patchB][c] / n;
      return clampInt(Math.round(ring - patch), -24, 24);
    });

    const feather = Math.max(4, Math.round(Math.min(w, h) * 0.14));
    for (let py = y; py < y + h; py++) {
      for (let px = x; px < x + w; px++) {
        const s0 = src(px, py);
        const si = at(s0.x, s0.y);
        const di = at(px, py);
        // 距框边的距离 → 羽化权重 (边界处保留原像素, 越往里越相信镜像块)
        const d = Math.min(px - x, y + h - 1 - py, x + w - 1 - px, py - y);
        const alpha = Math.min(1, (d + 1) / feather);
        for (let c = 0; c < 3; c++) {
          const mixed = Math.min(255, Math.max(0, data[si + c] + shift[c]));
          data[di + c] = Math.round(data[di + c] * (1 - alpha) + mixed * alpha);
        }
      }
    }
  } else {
    // 兜底: 用框外环均值铺满 (框过大时镜像没有意义)
    const rr = ringN ? ringR / ringN : 255;
    const gg = ringN ? ringG / ringN : 255;
    const bb = ringN ? ringB / ringN : 255;
    for (let py = y; py < y + h; py++) {
      for (let px = x; px < x + w; px++) {
        const di = at(px, py);
        data[di] = Math.round(rr);
        data[di + 1] = Math.round(gg);
        data[di + 2] = Math.round(bb);
      }
    }
  }

  // 3. 框内 3x3 平滑 (压掉镜像出来的重复纹理与接缝)
  const n = 3;
  const tmp = Buffer.from(data);
  for (let py = y; py < y + h; py++) {
    for (let px = x; px < x + w; px++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let cnt = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const qx = px + dx;
          const qy = py + dy;
          if (qx < x || qy < y || qx >= x + w || qy >= y + h) continue;
          const qi = at(qx, qy);
          r += tmp[qi];
          g += tmp[qi + 1];
          b += tmp[qi + 2];
          cnt++;
        }
      }
      if (cnt === 0) continue;
      const di = at(px, py);
      data[di] = Math.round(r / cnt);
      data[di + 1] = Math.round(g / cnt);
      data[di + 2] = Math.round(b / cnt);
    }
  }
  return method;
}

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

/** 源图 contain 适配进目标框 (默认不放大) */
function fitInside(
  srcW: number,
  srcH: number,
  boxW: number,
  boxH: number,
  allowUpscale = false,
): { w: number; h: number } {
  const k = Math.min(boxW / srcW, boxH / srcH, allowUpscale ? Number.POSITIVE_INFINITY : 1);
  return { w: Math.max(2, Math.round(srcW * k)), h: Math.max(2, Math.round(srcH * k)) };
}

/** 参考站抠图色板的语义键 → HEX。旧 bgColor 直接传 HEX 时也在这里兼容。 */
const MATTING_COLOR_HEX: Record<string, string> = {
  white: '#FFFFFF',
  'light-blue': '#82CEF3',
  blue: '#3988E9',
  red: '#FF0B22',
  'dark-red': '#A8001B',
};

type Backdrop =
  | { kind: 'transparent'; alpha: 0 }
  | { kind: 'solid'; color: number; alpha: number; hex: string };

/**
 * 背景颜色参数 → 画布色值。
 *
 * selectedColor 是参考站字段，优先级高于旧 bgColor；两者都缺省时输出透明底。
 * customAlpha 仅在自定义颜色时生效，0 直接视为透明（PNG），避免产出
 * 一张“全透明但仍写成 JPEG”的坏图。
 */
function resolveBackdropColor(params: Record<string, any>): Backdrop {
  const key = String(
    wasProvided(params, 'selectedColor') ? params.selectedColor : params.bgColor ?? 'transparent',
  );
  if (key === 'transparent') return { kind: 'transparent', alpha: 0 };

  let hex = MATTING_COLOR_HEX[key] ?? key;
  let alpha = 255;
  if (key === 'custom') {
    hex = String(params.customColor || '#5546D8').trim();
    const pct = clampNum(Number(params.customAlpha ?? 100), 0, 100);
    alpha = Math.round((pct / 100) * 255);
  }
  if (alpha <= 0) return { kind: 'transparent', alpha: 0 };

  const m = /^#?([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(hex.trim());
  if (!m) return { kind: 'solid', color: 0xffffffff, alpha: 255, hex: '#FFFFFF' };
  const n = parseInt(m[1], 16);
  const embeddedAlpha = m[2] ? parseInt(m[2], 16) : 255;
  alpha = Math.round((alpha * embeddedAlpha) / 255);
  return {
    kind: 'solid',
    color: rgbaToInt((n >> 16) & 255, (n >> 8) & 255, n & 255, alpha),
    alpha,
    hex: `#${m[1].toUpperCase()}`,
  };
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
