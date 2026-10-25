import { AppError } from '../common/app.exception';

/**
 * 用户上传图片的格式与像素边界校验。
 *
 * 不能只信 multer 给出的 `mimetype` / 扩展名：它们完全由客户端声明，改一个
 * 文件名就能把 HTML、压缩包甚至超大解码炸弹伪装成 PNG。这里先用文件头判定
 * 真实格式并读取尺寸，在 Jimp 完整解码前拒绝超限图片。
 */

export type SupportedImageMime = 'image/png' | 'image/jpeg' | 'image/webp';

export interface UploadedImageInfo {
  mime: SupportedImageMime;
  ext: 'png' | 'jpg' | 'webp';
  width: number;
  height: number;
  pixels: number;
}

/** 与前端 `lib/constants.ts` 的 MAX_IMAGE_MB 保持一致；可通过环境变量上调。 */
const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;
const DEFAULT_MAX_PIXELS = 40_000_000;

function envPositiveInt(name: string, fallback: number, max: number): number {
  const value = Number(process.env[name]);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(Math.floor(value), max);
}

export function maxUploadBytes(): number {
  return envPositiveInt('ASSET_MAX_UPLOAD_BYTES', DEFAULT_MAX_BYTES, 100 * 1024 * 1024);
}

export function maxUploadPixels(): number {
  return envPositiveInt('ASSET_MAX_PIXELS', DEFAULT_MAX_PIXELS, 200_000_000);
}

/** 受支持图片的真实格式；无法识别时返回 null，不做“按 JPEG 猜”的兜底。 */
export function detectImageMime(buf: Buffer): SupportedImageMime | null {
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    buf.length >= 12 &&
    buf.toString('ascii', 0, 4) === 'RIFF' &&
    buf.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

function pngDimensions(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 24 || buf.toString('ascii', 12, 16) !== 'IHDR') return null;
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  return width > 0 && height > 0 ? { width, height } : null;
}

function jpegDimensions(buf: Buffer): { width: number; height: number } | null {
  let offset = 2;
  const sofMarkers = new Set([
    0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
  ]);
  while (offset + 3 < buf.length) {
    if (buf[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    while (offset < buf.length && buf[offset] === 0xff) offset += 1;
    if (offset >= buf.length) return null;
    const marker = buf[offset++];
    if (marker === 0x01 || marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
      continue;
    }
    if (offset + 2 > buf.length) return null;
    const segmentLength = buf.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > buf.length) return null;
    if (sofMarkers.has(marker)) {
      if (segmentLength < 7) return null;
      const height = buf.readUInt16BE(offset + 3);
      const width = buf.readUInt16BE(offset + 5);
      return width > 0 && height > 0 ? { width, height } : null;
    }
    offset += segmentLength;
  }
  return null;
}

function webpDimensions(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 30) return null;
  const chunk = buf.toString('ascii', 12, 16);
  if (chunk === 'VP8X') {
    const width = 1 + buf.readUIntLE(24, 3);
    const height = 1 + buf.readUIntLE(27, 3);
    return width > 0 && height > 0 ? { width, height } : null;
  }
  if (chunk === 'VP8L' && buf[20] === 0x2f) {
    const bits = buf.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (chunk === 'VP8 ') {
    const start = buf.indexOf(Buffer.from([0x9d, 0x01, 0x2a]));
    if (start < 0 || start + 7 > buf.length) return null;
    const width = buf.readUInt16LE(start + 3) & 0x3fff;
    const height = buf.readUInt16LE(start + 5) & 0x3fff;
    return width > 0 && height > 0 ? { width, height } : null;
  }
  return null;
}

export function readImageDimensions(
  buf: Buffer,
  mime: SupportedImageMime,
): { width: number; height: number } | null {
  if (mime === 'image/png') return pngDimensions(buf);
  if (mime === 'image/jpeg') return jpegDimensions(buf);
  return webpDimensions(buf);
}

/** 校验用户上传图；失败抛 40001，调用方不得继续落库或扣费。 */
export function inspectUploadedImage(
  buf: Buffer,
  opts: { maxBytes?: number; maxPixels?: number } = {},
): UploadedImageInfo {
  const maxBytes = opts.maxBytes ?? maxUploadBytes();
  const maxPixels = opts.maxPixels ?? maxUploadPixels();
  if (!buf.length) throw new AppError(40001, '上传文件为空', 400);
  if (buf.length > maxBytes) {
    throw new AppError(40001, `图片不能超过 ${Math.floor(maxBytes / 1024 / 1024)} MB`, 400);
  }

  const mime = detectImageMime(buf);
  if (!mime) {
    throw new AppError(40001, '仅支持真实的 PNG、JPEG 或 WebP 图片', 400);
  }
  const dims = readImageDimensions(buf, mime);
  if (!dims) {
    throw new AppError(40001, '图片文件头损坏或缺少有效尺寸', 400);
  }
  const pixels = dims.width * dims.height;
  if (!Number.isSafeInteger(pixels) || pixels > maxPixels) {
    throw new AppError(
      40001,
      `图片像素超过限制（${dims.width}×${dims.height}，最多 ${maxPixels} 像素）`,
      400,
    );
  }
  return {
    mime,
    ext: mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg',
    width: dims.width,
    height: dims.height,
    pixels,
  };
}

/** 遮罩必须是真实 PNG，且尺寸与原图一致。 */
export function inspectMaskImage(
  buf: Buffer,
  expected: { width: number; height: number },
): UploadedImageInfo {
  const info = inspectUploadedImage(buf);
  if (info.mime !== 'image/png') {
    throw new AppError(40001, '遮罩必须是 PNG 图片', 400);
  }
  if (info.width !== expected.width || info.height !== expected.height) {
    throw new AppError(
      40001,
      `遮罩尺寸必须与原图一致（原图 ${expected.width}×${expected.height}，遮罩 ${info.width}×${info.height}）`,
      400,
    );
  }
  return info;
}

/**
 * 文件头合法不代表像素数据可解码。完成尺寸/像素上限检查后再交给 Jimp；
 * 这样损坏文件会在上传阶段被拒绝，而不会等到生成任务创建后才发现。
 */
export async function verifyDecodableImage(
  buf: Buffer,
  expected: { width: number; height: number },
): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Jimp } = require('jimp');
    const image = await Jimp.read(buf);
    if (image.bitmap.width !== expected.width || image.bitmap.height !== expected.height) {
      throw new AppError(40001, '图片声明的尺寸与实际解码尺寸不一致', 400);
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(40001, '图片无法解码或文件已损坏', 400);
  }
}
