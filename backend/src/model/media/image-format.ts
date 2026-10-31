/**
 * 图片格式的**字节魔数**判定。
 *
 * 为什么不能用 URL 后缀 / Content-Type 猜：多家上游返回的链接无扩展名
 * （如优云智算的 `.../d8021...`），按后缀猜会把 PNG 字节以 `image/jpeg`
 * 入库，产出记录的 mime 与真实内容不符。只有魔数可靠。
 *
 * 未知内容返回 `null`，由调用方决定兜底或判失败 —— 这里不猜。
 */

export type SupportedImageFormat = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';

/** 严格识别；未知内容返回 null */
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
