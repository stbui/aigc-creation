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

async function waitForContentScript(worker, tabId) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      await worker.evaluate(
        (id) => chrome.tabs.sendMessage(id, {
          type: 'huojue:get-context-menu-target'
        }),
        tabId
      );
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error('扩展 content script 未就绪');
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

test('保存结果先于进度消息到达时仍会显示成功提示', { timeout: 30_000 }, async () => {
  const server = http.createServer((_request, response) => {
    response.setHeader('Content-Type', 'text/html');
    response.end('<!doctype html><title>context-menu result test</title>');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const userDataDir = await mkdtemp(path.join(os.tmpdir(), 'huojue-extension-'));
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
    const tabId = await worker.evaluate(async () => {
      const tabs = await chrome.tabs.query({});
      const tab = tabs.find((item) =>
        item.url?.startsWith('http://example.test:')
      );
      if (!tab?.id) throw new Error('测试页签未找到');
      return tab.id;
    });
    await waitForContentScript(worker, tabId);

    await worker.evaluate(async ({ id }) => {
      await chrome.tabs.sendMessage(id, {
        type: 'huojue:save-result',
        traceId: 'result-without-progress',
        ok: true,
        imageUrl: 'https://example.com/image.webp',
        url: 'http://localhost:5100/uploads/test.png',
        assetId: 'asset-1',
        projectId: 'project-1',
        projectName: '默认分组'
      });
    }, { id: tabId });

    await page.waitForSelector('.huojue-toast--visible', { timeout: 3_000 });
    const toastState = await page.evaluate(() => {
      const toast = document.querySelector('.huojue-toast');
      return {
        state: toast?.dataset.state || null,
        text: toast?.textContent?.replace(/\s+/g, ' ').trim() || ''
      };
    });
    assert.equal(toastState.state, 'success');
    assert.match(toastState.text, /保存成功/);
  } finally {
    await context?.close();
    await new Promise((resolve) => server.close(resolve));
    await rm(userDataDir, { recursive: true, force: true });
  }
});
