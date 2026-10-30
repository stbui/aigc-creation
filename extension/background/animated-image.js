const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const MAX_FRAME_PIXELS = 40 * 1024 * 1024;

function matchesBytes(bytes, offset, values) {
  return values.every((value, index) => bytes[offset + index] === value);
}

function readUint32(bytes, offset) {
  return ((bytes[offset] << 24) >>> 0) +
    (bytes[offset + 1] << 16) +
    (bytes[offset + 2] << 8) +
    bytes[offset + 3];
}

function skipGifSubBlocks(bytes, start) {
  let offset = start;
  while (offset < bytes.length) {
    const length = bytes[offset++];
    if (length === 0) return offset;
    if (offset + length > bytes.length) return bytes.length;
    offset += length;
  }
  return offset;
}

function hasMultipleGifFrames(bytes) {
  if (bytes.length < 13) return false;
  let offset = 13;
  if (bytes[10] & 0x80) offset += 3 * (1 << ((bytes[10] & 7) + 1));
  let frameCount = 0;
  while (offset < bytes.length) {
    const marker = bytes[offset++];
    if (marker === 0x3b) break;
    if (marker === 0x21) {
      offset = skipGifSubBlocks(bytes, offset + 1);
      continue;
    }
    if (marker !== 0x2c || offset + 9 > bytes.length) break;
    const packed = bytes[offset + 8];
    offset += 9;
    if (packed & 0x80) offset += 3 * (1 << ((packed & 7) + 1));
    if (offset >= bytes.length) break;
    offset = skipGifSubBlocks(bytes, offset + 1);
    frameCount += 1;
    if (frameCount > 1) return true;
  }
  return false;
}

function getPngAnimationInfo(bytes) {
  let offset = 8;
  let frameCount = 0;
  let firstFrameBeforeIdat = false;
  while (offset + 12 <= bytes.length) {
    const size = readUint32(bytes, offset);
    const next = offset + 12 + size;
    if (next > bytes.length) break;
    if (matchesBytes(bytes, offset + 4, [97, 99, 84, 76]) && size >= 8) {
      frameCount = readUint32(bytes, offset + 8);
    } else if (matchesBytes(bytes, offset + 4, [102, 99, 84, 76])) {
      firstFrameBeforeIdat = true;
    } else if (matchesBytes(bytes, offset + 4, [73, 68, 65, 84])) {
      break;
    }
    offset = next;
  }
  return {
    animated: frameCount > 1,
    requiresAnimationDecoder: frameCount > 1 && !firstFrameBeforeIdat
  };
}

export function detectAnimatedImage(bytes) {
  if (matchesBytes(bytes, 0, [71, 73, 70, 56, 55, 97]) ||
      matchesBytes(bytes, 0, [71, 73, 70, 56, 57, 97])) {
    return { animated: hasMultipleGifFrames(bytes), mimeType: "image/gif" };
  }
  if (matchesBytes(bytes, 0, PNG_SIGNATURE)) {
    return { ...getPngAnimationInfo(bytes), mimeType: "image/png" };
  }
  if (matchesBytes(bytes, 0, [82, 73, 70, 70]) &&
      matchesBytes(bytes, 8, [87, 69, 66, 80])) {
    const extended = matchesBytes(bytes, 12, [86, 80, 56, 88]);
    return {
      animated: extended && Boolean(bytes[20] & 0x02),
      mimeType: "image/webp"
    };
  }
  if (matchesBytes(bytes, 4, [102, 116, 121, 112]) && bytes.length >= 16) {
    const boxEnd = Math.min(readUint32(bytes, 0), bytes.length);
    for (let offset = 8; offset + 4 <= boxEnd; offset += 4) {
      if (offset === 12) continue; // minor_version，不是品牌标记。
      if (!matchesBytes(bytes, offset, [97, 118, 105, 115])) continue;
      return {
        animated: true,
        mimeType: "image/avif",
        requiresAnimationDecoder: true
      };
    }
  }
  return { animated: false };
}

async function decodeFirstFrame(blob, bytes, animationInfo) {
  const Decoder = globalThis.ImageDecoder;
  let decoderSupported = false;
  if (typeof Decoder === "function" &&
      typeof Decoder.isTypeSupported === "function") {
    try {
      decoderSupported = await Decoder.isTypeSupported(animationInfo.mimeType);
    } catch {
      // 部分 Chrome Worker 上没有对应解码器，继续走安全的位图回退。
    }
  }
  if (decoderSupported) {
    const decoder = new Decoder({
      data: bytes,
      type: animationInfo.mimeType,
      preferAnimation: true
    });
    try {
      await decoder.tracks.ready;
      const { image } = await decoder.decode({ frameIndex: 0 });
      return { frame: image, closeDecoder: () => decoder.close() };
    } catch (error) {
      decoder.close();
      throw error;
    }
  }
  if (animationInfo.requiresAnimationDecoder) {
    throw new Error("此动图无法可靠提取首帧，请换一张图片重试。");
  }
  return { frame: await createImageBitmap(blob), closeDecoder: () => {} };
}

/** 将 GIF、APNG、动态 WebP/AVIF 的首帧转成静态 PNG；普通图片原样返回。 */
export async function freezeAnimatedImageFirstFrame(blob) {
  const header = new Uint8Array(await blob.slice(0, 32).arrayBuffer());
  if (!detectAnimatedImage(header).mimeType) return blob;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const animationInfo = detectAnimatedImage(bytes);
  if (!animationInfo.animated) return blob;

  const { frame, closeDecoder } = await decodeFirstFrame(blob, bytes, animationInfo);
  try {
    const width = frame.displayWidth || frame.width;
    const height = frame.displayHeight || frame.height;
    if (!width || !height || width * height > MAX_FRAME_PIXELS) {
      throw new Error("动图首帧尺寸过大，无法保存。");
    }
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("无法处理动图首帧。");
    context.drawImage(frame, 0, 0);
    const firstFrame = await canvas.convertToBlob({ type: "image/png" });
    if (!firstFrame.size || firstFrame.type !== "image/png") {
      throw new Error("动图首帧转换失败。");
    }
    return firstFrame;
  } finally {
    frame.close?.();
    closeDecoder();
  }
}
