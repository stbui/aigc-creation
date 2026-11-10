import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { chromium } from '../../frontend/node_modules/playwright/index.mjs';

const extensionRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const playwrightCache = path.join(os.homedir(), 'Library/Caches/ms-playwright');
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z7V8AAAAASUVORK5CYII=';

function findChromiumExecutable() {
  const cachedChromiumCandidates = existsSync(playwrightCache)
    ? readdirSync(playwrightCache)
        .filter((entry) => entry.startsWith('chromium-'))
        .sort()
        .reverse()
        .flatMap((entry) => [
          path.join(
            playwrightCache,
            entry,
            'chrome-mac/Chromium.app/Contents/MacOS/Chromium'
          ),
          path.join(
            playwrightCache,
            entry,
            'chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'
          )
        ])
    : [];

  return [
    process.env.CHROME_PATH,
    chromium.executablePath(),
    ...cachedChromiumCandidates,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser'
  ].find((candidate) => candidate && existsSync(candidate));
}

async function waitForTabsApi(worker) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      if (await worker.evaluate(() => typeof chrome?.tabs?.query === 'function')) {
        return;
      }
    } catch {
      // Service worker 启动期间 Playwright 可能暂时无法执行脚本。
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('扩展 service worker 的 tabs API 未就绪');
}

test('扩展重载后点击旧页面悬浮按钮会提示刷新页面', { timeout: 30_000 }, async () => {
  const image = Buffer.from(TINY_PNG_BASE64, 'base64');
  const server = http.createServer((request, response) => {
    if (request.url === '/image.png') {
      response.setHeader('Content-Type', 'image/png');
      response.end(image);
      return;
    }
    response.setHeader('Content-Type', 'text/html');
    response.end(
      '<!doctype html><title>extension reload test</title>' +
      '<img src="/image.png" width="400" height="300">'
    );
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const userDataDir = await mkdtemp(path.join(os.tmpdir(), 'huojue-reload-'));
  const executablePath = findChromiumExecutable();
  assert.ok(executablePath, '未找到可用于加载扩展的 Chrome/Chromium');

  let context;
  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      headless: true,
      executablePath,
      args: [
        `--disable-extensions-except=${extensionRoot}`,
        `--load-extension=${extensionRoot}`,
        '--host-resolver-rules=MAP example.test 127.0.0.1',
        '--no-proxy-server',
        '--disable-features=HttpsUpgrades'
      ]
    });

    let worker = context.serviceWorkers()[0];
    if (!worker) {
      worker = await context.waitForEvent('serviceworker', { timeout: 10_000 });
    }
    await waitForTabsApi(worker);
    const page = await context.newPage();
    await page.goto(`http://example.test:${port}/`);
    const imageBox = await page.locator('img[src="/image.png"]').boundingBox();
    assert.ok(imageBox, '测试图片未渲染');
    await page.mouse.move(
      imageBox.x + imageBox.width / 2,
      imageBox.y + imageBox.height / 2
    );
    await page.waitForSelector('.huojue-image-action--visible');

    await worker.evaluate(() => chrome.runtime.reload()).catch(() => {});
    await page.waitForTimeout(1_000);

    await page.locator('.huojue-image-action__primary').click();
    await page.waitForSelector('.huojue-toast--visible', { timeout: 2_000 });
    const text = await page.locator('.huojue-toast').innerText();
    assert.match(text, /扩展已更新|Extension updated/);
    assert.match(text, /刷新.*页面|Refresh.*page/i);
  } finally {
    await context?.close();
    await new Promise((resolve) => server.close(resolve));
    await rm(userDataDir, { recursive: true, force: true });
  }
});
