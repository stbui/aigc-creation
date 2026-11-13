import { describe, expect, it } from 'vitest';

import { AppError } from '../common/app.exception';
import {
  DEPLOYMENT_MAX_UPLOAD_PIXELS,
  inspectUploadedImage,
} from './image-validation';

/** 只构造文件头，不生成完整像素数据；校验器读取的正是这段元信息。 */
function pngBuffer(width: number, height: number, size = 64): Buffer {
  const buffer = Buffer.alloc(Math.max(size, 24));
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer, 0);
  buffer.write('IHDR', 12, 'ascii');
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}

describe('inspectUploadedImage 运行时限制', () => {
  it('按调用方传入的字节上限拒绝文件', () => {
    const buffer = pngBuffer(10, 10, 1024 * 1024 + 1);

    expect(() =>
      inspectUploadedImage(buffer, {
        maxBytes: 1024 * 1024,
        maxPixels: 1_000_000,
      }),
    ).toThrow('图片不能超过 1 MB');
  });

  it('按调用方传入的像素上限拒绝图片', () => {
    expect(() =>
      inspectUploadedImage(pngBuffer(100, 100), {
        maxBytes: 1024 * 1024,
        maxPixels: 9_999,
      }),
    ).toThrow('最多 9,999 像素');
  });

  it('按格式白名单拒绝未启用的真实格式', () => {
    expect(() =>
      inspectUploadedImage(pngBuffer(10, 10), {
        maxBytes: 1024 * 1024,
        maxPixels: 1_000_000,
        allowedMimes: ['image/jpeg'],
      }),
    ).toThrow('当前仅允许上传 JPG 图片');
  });

  it('调用方传入超过部署上限的像素值时仍按部署上限封顶', () => {
    let error: unknown;
    try {
      inspectUploadedImage(pngBuffer(20_000, 20_000), {
        maxPixels: DEPLOYMENT_MAX_UPLOAD_PIXELS * 10,
      });
    } catch (cause) {
      error = cause;
    }

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).message).toContain(
      `最多 ${DEPLOYMENT_MAX_UPLOAD_PIXELS.toLocaleString('en-US')} 像素`,
    );
  });

  it('调用方传入非有限限制时仍按部署上限校验', () => {
    expect(() =>
      inspectUploadedImage(pngBuffer(20_000, 20_000), {
        maxBytes: Number.NaN,
        maxPixels: Number.NaN,
      }),
    ).toThrow(`最多 ${DEPLOYMENT_MAX_UPLOAD_PIXELS.toLocaleString('en-US')} 像素`);
  });
});
