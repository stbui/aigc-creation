import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Jimp, JimpMime } from 'jimp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  BROWSE_THUMB,
  PICKER_THUMB,
  readThumbCache,
  renderThumbsFromBuffer,
  saveThumbCache,
  thumbCacheFile,
  warmThumbnails,
} from './thumb-render';
import { detectImageMime, readImageDimensions } from './image-validation';

/**
 * 预热是「素材库不再卡住」的关键：浏览时缩略图必须**全部命中磁盘缓存**。
 * 这里锁死三件事：变体尺寸与前端请求一致、二次调用不重算、不可解码文件安静跳过。
 */
describe('缩略图预热', () => {
  let root = '';
  let source: Buffer;
  /** 预热受 `ASSET_THUMBNAIL_ENABLED` 约束（默认关闭），测试里显式打开 */
  const originalFlag = process.env.ASSET_THUMBNAIL_ENABLED;

  beforeEach(async () => {
    process.env.ASSET_THUMBNAIL_ENABLED = 'true';
    root = await mkdtemp(join(tmpdir(), 'thumb-warm-'));
    await mkdir(join(root, 'original'), { recursive: true });
    // 320×180 的真实可解码图片（PNG，Jimp 编码）
    const image = new Jimp({ width: 320, height: 180, color: 0x336699ff });
    source = await image.getBuffer(JimpMime.png);
    await writeFile(join(root, 'original', 'photo.png'), source);
  });

  afterEach(async () => {
    if (originalFlag === undefined) delete process.env.ASSET_THUMBNAIL_ENABLED;
    else process.env.ASSET_THUMBNAIL_ENABLED = originalFlag;
    await rm(root, { recursive: true, force: true });
  });

  it('按前端实际请求的尺寸写入缓存（480 方形裁切 / 640 保留比例）', async () => {
    await warmThumbnails({ uploadsDir: root, key: 'original/photo.png', source });

    const picker = await readThumbCache(thumbCacheFile(root, 'original/photo.png', PICKER_THUMB));
    const browse = await readThumbCache(thumbCacheFile(root, 'original/photo.png', BROWSE_THUMB));
    expect(picker).not.toBeNull();
    expect(browse).not.toBeNull();

    const pickerMime = detectImageMime(picker!);
    const browseMime = detectImageMime(browse!);
    expect(readImageDimensions(picker!, pickerMime!)).toEqual({ width: 480, height: 480 });
    // 16:9 原图只限宽 → 640×360，不裁成方形
    expect(readImageDimensions(browse!, browseMime!)).toEqual({ width: 640, height: 360 });
  });

  it('已有缓存时不重算（文件时间戳不变）', async () => {
    await warmThumbnails({ uploadsDir: root, key: 'original/photo.png', source });
    const file = thumbCacheFile(root, 'original/photo.png', PICKER_THUMB);
    const first = await stat(file);

    await warmThumbnails({ uploadsDir: root, key: 'original/photo.png', source });

    expect((await stat(file)).mtimeMs).toBe(first.mtimeMs);
  });

  it('不是可解码图片时安静跳过，不写缓存也不抛错', async () => {
    await mkdir(join(root, 'generated'), { recursive: true });
    await expect(
      warmThumbnails({
        uploadsDir: root,
        key: 'generated/clip.mp4',
        source: Buffer.from('not an image'),
      }),
    ).resolves.toBeUndefined();
    expect(await readThumbCache(thumbCacheFile(root, 'generated/clip.mp4', PICKER_THUMB))).toBeNull();
  });

  it('开关关闭时不预热（关闭态下缩略图没有消费者）', async () => {
    process.env.ASSET_THUMBNAIL_ENABLED = 'false';
    await warmThumbnails({ uploadsDir: root, key: 'original/photo.png', source });
    expect(await readThumbCache(thumbCacheFile(root, 'original/photo.png', PICKER_THUMB))).toBeNull();
  });

  it('一次解码产出多个变体，原图不会被第一个变体裁掉比例', async () => {
    const rendered = await renderThumbsFromBuffer(source, [PICKER_THUMB, BROWSE_THUMB]);
    expect(rendered).toHaveLength(2);
    const browse = rendered.find((item) => item.spec === BROWSE_THUMB)!;
    const mime = detectImageMime(browse.body);
    expect(readImageDimensions(browse.body, mime!)).toEqual({ width: 640, height: 360 });
  });

  it('saveThumbCache 写盘后 readThumbCache 读回同一份字节', async () => {
    const file = thumbCacheFile(root, 'original/photo.png', PICKER_THUMB);
    const body = await readFile(join(root, 'original', 'photo.png'));
    await saveThumbCache(file, body);
    expect((await readThumbCache(file))?.equals(body)).toBe(true);
  });
});
