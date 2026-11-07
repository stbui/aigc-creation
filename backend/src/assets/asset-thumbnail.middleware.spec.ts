import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NextFunction, Request, Response } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Jimp, JimpMime } from 'jimp';

import { createAssetThumbnailMiddleware } from './asset-thumbnail.middleware';
import { detectImageMime, readImageDimensions } from './image-validation';

describe('asset thumbnail middleware', () => {
  let root = '';

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'asset-thumb-'));
    await mkdir(join(root, 'generated'), { recursive: true });
    const source = new Jimp({ width: 120, height: 160, color: 0xff336699 });
    await writeFile(
      join(root, 'generated', 'result.png'),
      await source.getBuffer(JimpMime.png),
    );
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('只传 w 时按宽度等比缩放，不裁成方形', async () => {
    const body = await requestThumb(root, { w: '60' });
    const mime = detectImageMime(body);
    expect(mime).toBe('image/jpeg');
    expect(readImageDimensions(body, mime!)).toEqual({ width: 60, height: 80 });
  });
});

function requestThumb(
  uploadsDir: string,
  query: Record<string, string>,
): Promise<Buffer> {
  const middleware = createAssetThumbnailMiddleware(uploadsDir);
  return new Promise((resolve, reject) => {
    let body = Buffer.alloc(0);
    const res = {
      setHeader: vi.fn(),
      status: vi.fn().mockReturnThis(),
      end: vi.fn((chunk: Buffer) => {
        body = Buffer.from(chunk);
        resolve(body);
      }),
    } as unknown as Response;
    const next: NextFunction = (error?: unknown) => {
      if (error) reject(error);
      else reject(new Error('middleware fell through to static asset'));
    };
    const req = {
      method: 'GET',
      path: '/uploads/generated/result.png',
      query,
    } as unknown as Request;

    try {
      middleware(req, res, next);
    } catch (error) {
      reject(error);
    }
  });
}
