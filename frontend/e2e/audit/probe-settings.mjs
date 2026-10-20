/**
 * 高级设置专项对拍 —— summary(收起态) + popover(展开态) 全量节点并排比对。
 * 用法: node probe-settings.mjs
 */
import { chromium } from 'playwright';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), 'out');
const EXEC = '/Users/bright/Library/Caches/ms-playwright/chromium-1134/chrome-mac/Chromium.app/Contents/MacOS/Chromium';
const TARGETS = { ref: 'https://ijihua.cn/free-creation', local: 'http://localhost:5173/free-creation' };

const b = await chromium.launch({ executablePath: EXEC });
const R = {};

for (const kind of ['ref', 'local']) {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
  const page = await ctx.newPage();
  await page.goto(TARGETS[kind], { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(5000);

  const pick = (sels) => sels;

  // ── ① 收起态 summary ──
  R[`${kind}|summary`] = await page.evaluate((sels) => {
    let el = null, used = '';
    for (const s of sels) { const e = document.querySelector(s); if (e) { el = e; used = s; break; } }
    if (!el) return null;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const kids = [...el.children].map((c) => {
      const k = getComputedStyle(c); const kr = c.getBoundingClientRect();
      return { tag: c.tagName, cls: (c.className.baseVal ?? c.className ?? '').toString().slice(0, 40), t: (c.innerText || c.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 20), box: [Math.round(kr.x), Math.round(kr.y), Math.round(kr.width), Math.round(kr.height)], fs: k.fontSize, fw: k.fontWeight, lh: k.lineHeight, c: k.color, bg: k.backgroundColor, bd: k.border, r: k.borderRadius, p: k.padding, m: k.margin };
    });
    return { sel: used, box: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)], fs: cs.fontSize, fw: cs.fontWeight, lh: cs.lineHeight, c: cs.color, bg: cs.backgroundColor, bd: cs.border, r: cs.borderRadius, p: cs.padding, gap: cs.gap, justify: cs.justifyContent, align: cs.alignItems, kids };
  }, pick(['.image-output-settings-summary', '.pk-settings-summary']));

  // ── ② 展开 popover 全量 ──
  await page.locator('.image-output-settings-summary, .pk-settings-summary').first().click();
  await page.waitForTimeout(800);

  R[`${kind}|popover`] = await page.evaluate(() => {
    let pop = null, used = '';
    for (const s of ['.image-output-settings-popover', '.pk-settings-popover']) { const e = document.querySelector(s); if (e) { pop = e; used = s; break; } }
    if (!pop) return null;
    const cs = getComputedStyle(pop);
    const r = pop.getBoundingClientRect();
    const desc = (e) => {
      const c = getComputedStyle(e); const b = e.getBoundingClientRect();
      return { tag: e.tagName, cls: (e.className.baseVal ?? e.className ?? '').toString().slice(0, 44), t: (e.innerText || e.textContent || '').replace(/\s+/g, '|').trim().slice(0, 44), box: [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)], fs: c.fontSize, fw: c.fontWeight, lh: c.lineHeight, c: c.color, bg: c.backgroundColor, bgi: c.backgroundImage.slice(0, 60), bd: c.border, r: c.borderRadius, p: c.padding, gap: c.gap, m: c.margin, display: c.display, dis: e.disabled === true || e.getAttribute('aria-disabled') === 'true' };
    };
    return {
      sel: used,
      box: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
      r: cs.borderRadius, p: cs.padding, gap: cs.gap, sh: cs.boxShadow, z: cs.zIndex, pos: cs.position, bottom: cs.bottom, left: cs.left, bg: cs.backgroundColor,
      // 全量叶子节点 (保留层级路径)
      leaves: (() => {
        const out = [];
        const walk = (e, path) => {
          if (e.children.length === 0 || e.tagName === 'SVG' || e.tagName === 'svg') {
            if ((e.innerText || e.textContent || '').trim() || e.tagName !== 'svg') out.push({ path, ...desc(e) });
            return;
          }
          [...e.children].forEach((c, i) => walk(c, `${path}>${c.tagName.toLowerCase()}${i}`));
        };
        [...pop.children].forEach((c, i) => walk(c, `${i}:${(c.className.baseVal ?? c.className ?? '').toString().split(' ')[0]}`));
        return out;
      })(),
      // 组容器
      groups: [...pop.children].map(desc),
    };
  });

  await page.screenshot({ path: join(OUT, `${kind}-settings.png`), clip: { x: 150, y: 100, width: 560, height: 790 } });
  await ctx.close();
}

await b.close();

console.log('╔══════════════════ 高级设置收起态 summary ══════════════════╗');
for (const k of ['summary']) {
  const r = R[`ref|${k}`], l = R[`local|${k}`];
  const f = (n) => n ? `[${n.sel}] box=${n.box.join(',')} fs=${n.fs} fw=${n.fw} lh=${n.lh} c=${n.c} bg=${n.bg} r=${n.r} p=${n.p} gap=${n.gap} | ${n.justify} ${n.align}` : '(未找到)';
  console.log('ref  : ' + f(r));
  console.log('local: ' + f(l));
  console.log('  ref kids:'); (r?.kids || []).forEach((k2) => console.log('    · ' + JSON.stringify(k2)));
  console.log('  local kids:'); (l?.kids || []).forEach((k2) => console.log('    · ' + JSON.stringify(k2)));
}

console.log('\n╔══════════════════ 高级设置展开态 popover ══════════════════╗');
{
  const r = R['ref|popover'], l = R['local|popover'];
  const f = (n) => n ? `[${n.sel}] box=${n.box.join(',')} r=${n.r} p=${n.p} gap=${n.gap} z=${n.z} ${n.pos} bottom=${n.bottom} bg=${n.bg} sh=${n.sh}` : '(未找到)';
  console.log('ref  : ' + f(r));
  console.log('local: ' + f(l));
  const fl = (n) => n?.leaves.map((x) => `    ${x.path.padEnd(22)} ${x.tag.padEnd(7)} ${String(x.box).padEnd(20)} fs=${String(x.fs).padEnd(7)} fw=${String(x.fw).padEnd(4)} lh=${String(x.lh).padEnd(9)} c=${String(x.c).padEnd(20)} bg=${String(x.bg).padEnd(21)} r=${String(x.r).padEnd(6)} bd=${x.bd} dis=${x.dis} «${x.t}»`).join('\n');
  console.log('\n--- ref leaves ---\n' + fl(r));
  console.log('\n--- local leaves ---\n' + fl(l));
}