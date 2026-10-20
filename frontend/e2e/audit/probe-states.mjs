/**
 * 定点验证: 提交按钮 disabled 态 + dropzone 内层结构 + 高级设置展开态 —— ref vs local。
 * 用法: node probe-states.mjs
 */
import { chromium } from 'playwright';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), 'out');
const EXEC = '/Users/bright/Library/Caches/ms-playwright/chromium-1134/chrome-mac/Chromium.app/Contents/MacOS/Chromium';
const TARGETS = { ref: 'https://ijihua.cn/free-creation', local: 'http://localhost:5173/free-creation' };

const b = await chromium.launch({ executablePath: EXEC });

for (const kind of ['ref', 'local']) {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
  const page = await ctx.newPage();
  await page.goto(TARGETS[kind], { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(5000);

  // ① 提交按钮: disabled 属性 / computed opacity / background-image / 文本
  const btn = await page.evaluate(() => {
    const cands = [...document.querySelectorAll('button')].filter((b) => {
      const t = (b.innerText || '').replace(/\s+/g, '').trim();
      return t.includes('登录免费生图') || t.includes('登录免费生成') || t.includes('立即生成') || t.includes('免费生图');
    });
    const el = cands[0];
    if (!el) return { found: false, all: [...document.querySelectorAll('button')].map((x) => (x.innerText || '').replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 30) };
    const cs = getComputedStyle(el);
    return {
      found: true,
      text: (el.innerText || '').replace(/\s+/g, ' ').trim(),
      disabledProp: el.disabled === true,
      ariaDisabled: el.getAttribute('aria-disabled'),
      className: el.className,
      opacity: cs.opacity,
      cursor: cs.cursor,
      backgroundColor: cs.backgroundColor,
      backgroundImage: cs.backgroundImage.slice(0, 120),
      fontSize: cs.fontSize,
      fontWeight: cs.fontWeight,
      lineHeight: cs.lineHeight,
      letterSpacing: cs.letterSpacing,
      gap: cs.gap,
      padding: cs.padding,
      borderRadius: cs.borderRadius,
      html: el.outerHTML.slice(0, 400),
    };
  });
  console.log(`\n████ ${kind.toUpperCase()} 提交按钮 ████`);
  console.log(JSON.stringify(btn, null, 2).slice(0, 1800));

  // ② dropzone 内层
  const dz = await page.evaluate(() => {
    const z = document.querySelector('[class*="dropzone"],[class*="upload-slot"],[class*="upload-zone"]');
    if (!z) return { found: false };
    const inner = [...z.children].map((c) => {
      const cs = getComputedStyle(c);
      const r = c.getBoundingClientRect();
      return { tag: c.tagName, cls: c.className, box: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)], display: cs.display, radius: cs.borderRadius, padding: cs.padding, gap: cs.gap, fs: cs.fontSize, lh: cs.lineHeight, color: cs.color, bg: cs.backgroundColor, html: c.outerHTML.slice(0, 260) };
    });
    const zc = getComputedStyle(z);
    const zr = z.getBoundingClientRect();
    return {
      found: true,
      zone: { cls: z.className, box: [Math.round(zr.x), Math.round(zr.y), Math.round(zr.width), Math.round(zr.height)], display: zc.display, gap: zc.gap, padding: zc.padding, align: zc.alignItems, justify: zc.justifyContent },
      inner,
    };
  });
  console.log(`──── ${kind} dropzone ────`);
  console.log(JSON.stringify(dz, null, 2).slice(0, 2200));

  await page.screenshot({ path: join(OUT, `${kind}-probe.png`) });
  await ctx.close();
}
await b.close();