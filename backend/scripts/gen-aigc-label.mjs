/**
 * 重新生成「AI 生成」角标（`assets/aigc-label.png` + `src/common/aigc-label-badge.ts`）。
 *
 * 为什么需要这个脚本
 * ----------------
 * Jimp 内置字体只有 ASCII，运行时画不出中文。角标只能**预先渲染成位图**，
 * 再由 `common/aigc-label.ts` 用 Jimp 合成到生成图上。渲染需要浏览器排版引擎，
 * 故用 Playwright + 系统 Chrome —— 本机没有 Chromium 二进制
 *（`channel: 'chrome'`），与 frontend/e2e 的做法一致。
 *
 * 产物有两份，缺一不可：
 *   · `assets/aigc-label.png`      —— 源图，便于日后替换与比对；
 *   · `src/common/aigc-label-badge.ts` —— base64 常量，`nest build`（tsc）
 *     不会复制图片资源，运行时按路径读必然 ENOENT，所以只能内嵌。
 *
 * 用法（在 backend/ 目录下；需要 playwright 包，来自 frontend 的 node_modules）:
 *   node scripts/gen-aigc-label.mjs
 *
 * 参数（改文案 / 配色时才用）:
 *   --text "AI 生成"   角标文字（默认「AI 生成」）
 *   --color "#5546d8"  圆点颜色（默认品牌紫）
 *
 * 改完文案或配色后**必须重跑**，否则代码里的 base64 还是旧图。
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const TEXT = arg('text', 'AI 生成');
const COLOR = arg('color', '#5546d8');
// 2x 视网膜：合成时缩放到目标宽度，源图分辨率不足会糊
const W = 276;
const H = 88;

/** playwright 可能只装在 frontend/node_modules 里 —— 两处都找 */
function loadPlaywright() {
  const candidates = [
    'playwright',
    path.join(ROOT, '..', 'frontend', 'node_modules', 'playwright'),
  ];
  for (const name of candidates) {
    try {
      return require(name);
    } catch {
      /* 继续找下一个 */
    }
  }
  throw new Error('未找到 playwright：请在 frontend/ 下安装，或 npm i -D playwright@1.64.1');
}

const { chromium } = loadPlaywright();

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
  html, body { margin: 0; padding: 0; background: transparent; }
  .badge {
    box-sizing: border-box;
    width: ${W}px; height: ${H}px;
    display: flex; align-items: center; gap: 14px;
    padding: 0 26px;
    border-radius: 18px;
    background: rgba(23, 26, 43, 0.72);
    font-family: "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
    font-size: 40px; font-weight: 600; letter-spacing: 2px;
    color: #ffffff; white-space: nowrap;
  }
  .dot { width: 16px; height: 16px; border-radius: 50%; background: ${COLOR}; flex: none; }
</style></head>
<body><div class="badge"><span class="dot"></span><span>${TEXT}</span></div></body></html>`;

const browser = await chromium.launch({ channel: 'chrome' });
try {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: 'load' });
  const el = await page.$('.badge');
  const png = await el.screenshot({ omitBackground: true });
  if (!png?.length) throw new Error('截图失败：未拿到 PNG 字节');
  if (png.subarray(1, 4).toString('latin1') !== 'PNG') throw new Error('截图不是 PNG');

  const pngPath = path.join(ROOT, 'assets', 'aigc-label.png');
  fs.mkdirSync(path.dirname(pngPath), { recursive: true });
  fs.writeFileSync(pngPath, png);

  // base64 按 120 字符折行，避免单行常量把编辑器与 diff 撑爆
  const b64 = png.toString('base64');
  const lines = [];
  for (let i = 0; i < b64.length; i += 120) lines.push(`  "${b64.slice(i, i + 120)}"`);
  const ts = `/**
 * 可见 AIGC 角标（预置 PNG，base64 内嵌）。
 *
 * 为什么内嵌而不是运行时读文件
 * --------------------------
 * 1. \`nest build\` 用 tsc，只编译 TS —— 放在 src/ 下的图片不会进 dist/，
 *    运行时按 __dirname 拼路径必然 ENOENT；
 * 2. 这是**每张生成图都要合成**的热资源，内嵌后免去每次生成的一次磁盘读。
 *
 * 图片内容：半透明深底 + 白字「${TEXT}」+ 品牌紫圆点，${W}x${H}（2x 视网膜），
 * 合成时缩放到目标图宽度的 1/5 并贴在右下角。中文字形由系统字体渲染后
 * 固化成位图 —— Jimp 内置字体只有 ASCII，运行时根本画不出中文。
 * 重新生成脚本见 scripts/gen-aigc-label.mjs（需要 Playwright + 系统 Chrome）。
 *
 * 源图保存在 backend/assets/aigc-label.png，便于替换后重新生成本常量。
 *
 * ⚠️ 本文件由脚本生成，**不要手改** —— 下次重跑会被覆盖。
 */
export const AIGC_LABEL_PNG_BASE64 =
${lines.join(' +\n')};
`;
  fs.writeFileSync(path.join(ROOT, 'src', 'common', 'aigc-label-badge.ts'), ts);
  console.log(`已生成 ${path.relative(ROOT, pngPath)} (${png.length}B) 与 src/common/aigc-label-badge.ts (${b64.length} base64)`);
} finally {
  await browser.close();
}
