/**
 * 手机上传页面的纯函数与外部工具入口 —— 目录内文件的唯一本页工具来源。
 */

import { MAX_EDGE, QUALITY } from './constants';

/** 图片格式 / 体积校验（与全站上传同源） */
export {
  MAX_IMAGE_MB,
  SUPPORTED_IMAGE_ACCEPT,
  SUPPORTED_IMAGE_LABEL,
  isSupportedImageFile,
} from '../../lib/constants';

/**
 * 压缩图片 —— canvas 重绘, 输出 JPEG。
 *
 * ⚠️ **压缩失败必须回退传原图**: 有些手机相册存的是 HEIC, 浏览器解不出,
 * 若此处直接抛错, 用户就彻底传不上图了 —— 而原图后端是能收的。
 */
export async function compressImage(
  file: File,
): Promise<{ file: File; compressed: boolean; edge?: number }> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return { file, compressed: false };
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', QUALITY),
    );
    if (!blob) return { file, compressed: false };

    // 压完反而更大 (本来就是小图) 就用原图
    if (blob.size >= file.size) return { file, compressed: false };

    return {
      file: new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }),
      compressed: true,
      edge: Math.max(width, height),
    };
  } catch {
    return { file, compressed: false };
  }
}
