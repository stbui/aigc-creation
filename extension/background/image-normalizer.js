import { freezeAnimatedImageFirstFrame } from "./animated-image.js";

/**
 * 站点只接受 PNG / JPEG / WebP，且体积与像素数都有硬上限
 * （`backend/src/assets/image-validation.ts`：默认 10MB、4000 万像素，
 * 可用 `ASSET_MAX_UPLOAD_BYTES` 调整）。
 *
 * 采集页上的图往往是 AVIF、GIF、几千万像素的巨图或几十 MB 的原图，
 * **必须在扩展侧转码**：原样上传只会拿到一个「图片格式不支持」的 400，
 * 用户却不知道该怎么办。这里的数值与后端默认值对齐，改一处要同步另一处。
 */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const MAX_UPLOAD_PIXELS = 40_000_000;

const SUPPORTED_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const JPEG_QUALITY = 0.9;
const MAX_SCALE_ATTEMPTS = 6;

/**
 * 把任意可解码图片变成「站点一定收得下」的 Blob。
 *
 * 已经合规的 PNG/JPEG/WebP **原样返回**，不重新编码 —— 重编码会掉画质、
 * 也会悄悄丢掉 PNG 的透明通道，用户拿到的就不再是他采集的那张图了。
 */
export async function prepareImageForUpload(blob) {
  const frozen = await freezeAnimatedImageFirstFrame(blob);
  const bitmap = await decodeBitmap(frozen);

  try {
    const width = bitmap.width;
    const height = bitmap.height;
    if (!width || !height) {
      throw new Error("该图片没有可用的尺寸信息。");
    }

    const alreadyCompatible =
      SUPPORTED_TYPES.has(normalizeMimeType(frozen.type)) &&
      frozen.size <= MAX_UPLOAD_BYTES &&
      width * height <= MAX_UPLOAD_PIXELS;

    if (alreadyCompatible) {
      return { blob: frozen, width, height };
    }

    const reencoded = await reencodeWithinLimits(bitmap, frozen.type);
    return { blob: reencoded.blob, width: reencoded.width, height: reencoded.height };
  } finally {
    bitmap.close?.();
  }
}

/** 生成上传文件名（服务端不信任扩展名，只按字节魔数判定，这里仅为可读性） */
export function buildUploadFileName(mimeType, prefix = "capture") {
  const extension = normalizeMimeType(mimeType) === "image/png" ? "png" : "jpg";
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${Date.now()}-${suffix}.${extension}`;
}

async function decodeBitmap(blob) {
  try {
    return await createImageBitmap(blob);
  } catch {
    throw new Error("该图片无法解码（可能是受保护的图片），请换一张重试。");
  }
}

/**
 * 重编码并按需缩小，直到同时满足体积与像素上限。
 *
 * 输出格式：源图是 PNG / WebP 时保留 PNG（大概率带透明通道，
 * 转 JPEG 会把透明区变成黑块）；其余一律 JPEG，避免大照片编码成 PNG 后
 * 体积反而更大、还得多缩一轮。
 */
async function reencodeWithinLimits(bitmap, sourceMimeType) {
  const sourceType = normalizeMimeType(sourceMimeType);
  const outputType = sourceType === "image/png" || sourceType === "image/webp"
    ? "image/png"
    : "image/jpeg";
  const maxSideScale = Math.min(
    1,
    Math.sqrt(MAX_UPLOAD_PIXELS / (bitmap.width * bitmap.height))
  );
  let scale = maxSideScale;

  for (let attempt = 0; attempt < MAX_SCALE_ATTEMPTS; attempt += 1) {
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const blob = await drawToBlob(bitmap, width, height, outputType);

    if (blob.size <= MAX_UPLOAD_BYTES) {
      return { blob, width, height };
    }
    scale *= 0.8;
  }

  throw new Error("图片处理后仍超过 10MB，请换一张尺寸更小的图片。");
}

async function drawToBlob(bitmap, width, height, type) {
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("图片处理失败：浏览器无法创建画布。");
  }

  // JPEG 没有透明通道：不铺底色，透明区域会被编码成黑色。
  if (type === "image/jpeg") {
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
  }
  context.drawImage(bitmap, 0, 0, width, height);

  const blob = type === "image/jpeg"
    ? await canvas.convertToBlob({ type, quality: JPEG_QUALITY })
    : await canvas.convertToBlob({ type });
  if (!blob?.size) {
    throw new Error("图片转码失败，请重试。");
  }
  return blob;
}

function normalizeMimeType(value = "") {
  return String(value).split(";", 1)[0].trim().toLowerCase();
}
