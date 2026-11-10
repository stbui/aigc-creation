import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { chromium } from '../../frontend/node_modules/playwright/index.mjs';

const require = createRequire(import.meta.url);
const { Jimp } = require('../../backend/node_modules/jimp');
const extensionRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// 2x2 VP8 WebP。后端 Jimp 1.6.1 默认没有 WebP 解码器，因此扩展不能把它原样上传。
const TINY_WEBP_BASE64 =
  'UklGRjwAAABXRUJQVlA4IDAAAADQAQCdASoCAAIAAgA0JaACdLoB+AADsAD+8Oj3/yC5YXXI1/8gP+QH/ID/+PIAAAA=';

test('WebP 采集结果会转成后端可解码的 PNG', { timeout: 20_000 }, async () => {
  const server = http.createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
      if (pathname === '/') {
        res.setHeader('Content-Type', 'text/html');
        res.end('<!doctype html><title>image-normalizer test</title>');
        return;
      }

      const file = path.join(extensionRoot, pathname);
      if (!file.startsWith(`${extensionRoot}${path.sep}`)) {
        res.statusCode = 404;
        res.end('not found');
        return;
      }

      const body = await readFile(file);
      res.setHeader(
        'Content-Type',
        file.endsWith('.js') ? 'text/javascript' : 'application/octet-stream'
      );
      res.end(body);
    } catch {
      res.statusCode = 404;
      res.end('not found');
    }
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const executablePath = [
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser'
  ].find((candidate) => candidate && existsSync(candidate));
  const browser = await chromium.launch(
    executablePath ? { executablePath } : undefined
  );

  try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${port}/`);
    const prepared = await page.evaluate(async (base64) => {
      const { prepareImageForUpload } = await import('/background/image-normalizer.js');
      const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
      const result = await prepareImageForUpload(new Blob([bytes], { type: 'image/webp' }));
      return {
        bytes: Array.from(new Uint8Array(await result.blob.arrayBuffer())),
        height: result.height,
        type: result.blob.type,
        width: result.width
      };
    }, TINY_WEBP_BASE64);

    assert.equal(prepared.type, 'image/png');
    assert.equal(prepared.width, 2);
    assert.equal(prepared.height, 2);

    const decoded = await Jimp.read(Buffer.from(prepared.bytes));
    assert.equal(decoded.bitmap.width, 2);
    assert.equal(decoded.bitmap.height, 2);
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
