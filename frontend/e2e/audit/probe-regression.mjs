/**
 * 多页面回归探针 —— 验证共用 ToolSettingsPopover / pk-* 布局的页面在 CSS 改动后无回归。
 * 用法: node probe-regression.mjs
 */
import { chromium } from 'playwright';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const EXEC = '/Users/bright/Library/Caches/ms-playwright/chromium-1134/chrome-mac/Chromium.app/Contents/MacOS/Chromium';

// 共用 ToolSettingsPopover 的页面 (pk-* 布局 + 高级设置)
const PATHS = [
  '/free-creation', '/product-kit', '/product-detail', '/viral-clone',
  '/multi-image-fusion', '/local-redraw', '/background-remove',
];

const isVisible = async (loc) => {
  const box = await loc.boundingBox();
  return box !== null && box.width > 0 && box.height > 0 && (await loc.isVisible());
};

/**
 * 表单卡判据：不能用单一 selector —— multi-image-fusion 是独立骨架
 * (`.multi-image-fusion-page`, 表面附扇卡片网格, 无 .pk-form-card),
 * 用 `.first()` 硬等会 30s 超时, 把「selector 不匹配」误报成「页面崩了」。
 * 改为: 任一已知页面主容器可见即通过, 都不可见才算 FAIL。
 */
const FORM_SELECTORS = [
  '.pk-form-card', '.fc-form-card', '.tool-form-card',
  '.multi-image-fusion-page', '.pk-workspace',
];
const formOk = async (page) => {
  for (const s of FORM_SELECTORS) {
    const loc = page.locator(s).first();
    if ((await loc.count()) > 0 && (await isVisible(loc))) return s;
  }
  return null;
};

const b = await chromium.launch({ executablePath: EXEC });
let pass = 0, fail = 0;

for (const path of PATHS) {
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push('pageerror: ' + e.message.split('\n')[0]));
  p.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('[antd:')) errs.push('console: ' + m.text().slice(0, 120)); });

  await p.goto(`http://localhost:5173${path}`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(3500);

  // ① 页面基本结构
  const formSel = await formOk(p);
  const hist = await p.locator('.tool-history-card').count();

  // ② 高级设置 summary (若该页有)
  let settings = 'n/a';
  const sum = p.locator('.pk-settings-summary').first();
  if (await sum.count()) {
    const s = await sum.evaluate((el) => {
      const c = getComputedStyle(el);
      return { r: c.borderRadius, p: c.padding, h: Math.round(el.getBoundingClientRect().height) };
    }).catch(() => null);
    if (s) {
      // ③ 展开看比例卡字号 (若该页有 ratio 组)
      await sum.click();
      await p.waitForTimeout(600);
      const small = await p.locator('.pk-ratio-option small').first().evaluate((el) => getComputedStyle(el).fontSize).catch(() => null);
      const pop = await p.locator('.pk-settings-popover').first().evaluate((el) => {
        const c = getComputedStyle(el); const b = el.getBoundingClientRect();
        return { w: Math.round(b.width), h: Math.round(b.height), r: c.borderRadius };
      }).catch(() => null);
      const h2 = await p.locator('.fc-settings-popover-head h2').first().evaluate((el) => {
        const c = getComputedStyle(el); return { fw: c.fontWeight, c: c.color };
      }).catch(() => null);
      settings = `sum[r=${s.r} p=${s.p} h=${s.h}] ratioSmall=${small ?? '—'} pop[${pop ? pop.w + 'x' + pop.h + ' r' + pop.r : '—'}] h2[${h2 ? h2.fw + ' ' + h2.c : '—'}]`;
    }
  }

  const ok = hist === 0 && Boolean(formSel) && errs.length === 0;
  ok ? pass++ : fail++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${path.padEnd(22)} 表单容器=${formSel ?? '未找到'} 历史=${hist} 错误=${errs.length}  ${settings}`);
  if (errs.length) console.log('      ', errs.slice(0, 2).join(' | '));

  await p.close();
}
await b.close();
console.log(`\n结论: ${pass} passed / ${fail} failed`);