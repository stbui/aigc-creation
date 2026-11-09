/**
 * 浏览器启动参数的统一出口。
 *
 * 背景：本机 `npx playwright install` 被 broker 拦截（safe-delete 拒绝删除
 * `__dirlock`），缓存里的 chromium-1134 与 playwright 1.64.1 期望的 1248
 * 版本号不一致，故需显式指定可执行文件绕过版本校验 —— 与
 * `playwright.admin.config.ts` 同一套理由。
 *
 * 优先级：`CHROMIUM_PATH` 环境变量 → 本机已知缓存路径 → undefined
 * （交给 playwright 自己解析；路径不存在时 launch 会直接失败并给出提示，
 * 不会静默退化成"没截图"）。
 */

import { existsSync } from 'node:fs';

const LOCAL_CHROMIUM_PATH =
  '/Users/bright/Library/Caches/ms-playwright/chromium-1134/chrome-mac/Chromium.app/Contents/MacOS/Chromium';

/** 显式可执行文件路径；`undefined` 表示交给 playwright 自行解析。 */
export const CHROMIUM_PATH = process.env.CHROMIUM_PATH
  ?? (existsSync(LOCAL_CHROMIUM_PATH) ? LOCAL_CHROMIUM_PATH : undefined);

/**
 * 启动 Chromium。
 *
 * 默认语义与 `chromium.launch({ executablePath })` 一致（无头、无额外参数）；
 * 需要直连本机服务（绕开系统代理）的脚本显式传 `args: ['--no-proxy-server']`。
 *
 * @param {object} [options]
 * @param {boolean} [options.headless] 是否无头，默认无头。
 * @param {string[]} [options.args] 额外命令行参数。
 * @returns {Promise<import('playwright').Browser>}
 */
export async function launchChromium(options = {}) {
  const { chromium } = await import('playwright');
  return chromium.launch({
    executablePath: CHROMIUM_PATH,
    headless: options.headless ?? true,
    args: options.args ?? [],
  });
}
