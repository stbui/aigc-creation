/**
 * 图片格式魔数判定 (2026-10-20 抽为独立模块)。
 *
 * ## 为什么要独立成文件
 *
 * `sniffImageFormat` 原先住在 `modelverse-image.provider.ts` 里, 而
 * `image-provider-base.ts` 要 import 它 —— 于是当 modelverse 改为继承
 * 基座后, 就成了 modelverse → base → modelverse 的**循环依赖**:
 *   - Node 的 CJS require 会在加载时拿到未完成的 exports (sniffImageFormat 为 undefined)
 *   - 表现为"继承基座后一调用就 TypeError: not a function", 且极难定位
 *
 * 抽成叶子模块后, 依赖方向是单向的: 两者都 → image-format, 无环。
 *
 * ## 为什么必须按字节魔数判定, 不能看 URL 后缀
 *
 * 实测教训 (2026-10-20): 优云智算返回的 OSS 链接形如
 * `.../d8021...` —— 完全没有扩展名, 按 `.png` 猜会得到错误结论。
 * 而 generate.service 按 format 决定落库扩展名与存储 mime
 * (generate.service.ts `ext = format === 'image/png' ? 'png' : 'jpg'`),
 * 猜错就把 PNG 字节以 image/jpeg 入库, 产出 mime 与真实内容不符。
 * 只有魔数是可靠的。
 */
export type SupportedImageFormat = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';

/** 严格识别；未知内容返回 null，调用方应判失败而不是按 JPEG 碰运气。 */
export function detectImageFormat(buf: Buffer): SupportedImageFormat | null {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return 'image/png'; // \x89PNG
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return 'image/jpeg'; // \xFF\xD8\xFF
  }
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    return 'image/webp';
  }
  if (buf.length >= 3 && buf.toString('ascii', 0, 3) === 'GIF') return 'image/gif';
  return null;
}

/** 旧调用方的兼容门面；新代码应使用 detectImageFormat 并显式处理 null。 */
export function sniffImageFormat(buf: Buffer): string {
  return detectImageFormat(buf) ?? 'image/jpeg';
}
