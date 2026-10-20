/**
 * 收官 probe: 主区外框 padding / actions 底色 / 分辨率卡 / chip / 侧栏分组。
 * 用法: node probe-shell.mjs
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

  // 主区外框
  const shell = await page.evaluate(() => {
    const sels = ['.workspace-view-root', '.app-body', '.app-content', '.pk-workspace', '.free-creation-layout', '.pk-form-scroll', '.free-form-scroll'];
    const out = {};
    for (const s of sels) {
      const el = document.querySelector(s);
      if (!el) continue;
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      out[s] = { box: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)], p: cs.padding, m: cs.margin, h: cs.height, gap: cs.gap, bg: cs.backgroundColor };
    }
    return out;
  });
  console.log(`\n════ ${kind} 主区外框 ════`);
  console.log(JSON.stringify(shell, null, 2));

  // actions 底色带（取提交区上方 8px 处的元素背景）
  const band = await page.evaluate(() => {
    const area = document.querySelector('.free-actions, .fc-actions');
    if (!area) return null;
    const cs = getComputedStyle(area);
    const r = area.getBoundingClientRect();
    return { cls: area.className, box: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)], bg: cs.backgroundColor, p: cs.padding, gap: cs.gap, kids: [...area.children].map((c) => { const k = getComputedStyle(c); const kr = c.getBoundingClientRect(); return { cls: c.className, box: [Math.round(kr.x), Math.round(kr.y), Math.round(kr.width), Math.round(kr.height)], bg: k.backgroundColor }; }) };
  });
  console.log(`──── ${kind} actions 区 ────`);
  console.log(JSON.stringify(band, null, 2));

  // chip / 高级设置条细节
  const chips = await page.evaluate(() => {
    const g = (s) => [...document.querySelectorAll(s)].map((e) => { const cs = getComputedStyle(e); const r = e.getBoundingClientRect(); return { t: (e.innerText || e.textContent || '').replace(/\s+/g, ' ').trim(), box: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)], fs: cs.fontSize, fw: cs.fontWeight, c: cs.color, bg: cs.backgroundColor, bd: cs.border, r: cs.borderRadius, p: cs.padding, lh: cs.lineHeight }; });
    return { chips: g('[class*="output-settings"] span, .pk-settings-chip'), chev: g('[class*="settings"] svg, .pk-settings-chevron') };
  });
  console.log(`──── ${kind} chips ────`);
  console.log(JSON.stringify(chips, null, 2).slice(0, 1600));

  // 分辨率卡
  await page.locator('.image-output-settings-summary, .pk-settings-summary').first().click();
  await page.waitForTimeout(700);
  const res = await page.evaluate(() => {
    const sels = ['.image-output-resolution-option', '.pk-resolution-option'];
    for (const s of sels) {
      const els = [...document.querySelectorAll(s)];
      if (!els.length) continue;
      return els.map((e) => { const cs = getComputedStyle(e); const r = e.getBoundingClientRect(); return { t: e.innerText.replace(/\s+/g, '|').trim(), box: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)], bg: cs.backgroundColor, bd: cs.border, r: cs.borderRadius, p: cs.padding, dis: e.disabled === true }; });
    }
    return null;
  });
  console.log(`──── ${kind} 分辨率卡 ────`);
  console.log(JSON.stringify(res, null, 2));

  // popover head 间隙
  const popGap = await page.evaluate(() => {
    const p = document.querySelector('.image-output-settings-popover, .pk-settings-popover');
    if (!p) return null;
    const cs = getComputedStyle(p);
    const kids = [...p.children].map((c) => { const k = getComputedStyle(c); const kr = c.getBoundingClientRect(); return { cls: c.className, top: Math.round(kr.y), h: Math.round(kr.height), gap: k.gap, p: k.padding }; });
    return { popGap: cs.gap, p: cs.padding, kids };
  });
  console.log(`──── ${kind} popover 间隙 ────`);
  console.log(JSON.stringify(popGap, null, 2));

  await ctx.close();
}
await b.close();