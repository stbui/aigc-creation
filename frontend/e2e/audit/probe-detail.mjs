/**
 * 精确 probe: ref 的 .primary-btn / 高级设置 summary / textarea / 上传标签 —— 与 local 同名 selector 对拍。
 * 用法: node probe-detail.mjs
 */
import { chromium } from 'playwright';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), 'out');
const EXEC = '/Users/bright/Library/Caches/ms-playwright/chromium-1134/chrome-mac/Chromium.app/Contents/MacOS/Chromium';
const TARGETS = { ref: 'https://ijihua.cn/free-creation', local: 'http://localhost:5173/free-creation' };

const PICK = [
  ['主按钮', ['button.primary-btn', '.free-submit-area button', '.pk-primary-btn']],
  ['高级设置条', ['button.image-output-settings-summary', '.pk-settings-summary']],
  ['高级设置标签', ['.image-output-settings-label', '.pk-settings-label']],
  ['比例 chip', ['.image-output-ratio-chip', '.pk-settings-chip']],
  ['上传标题', ['.free-upload-title-row strong', '.free-upload-title-row > span', '.pk-section-title']],
  ['上传占位label', ['label.free-upload-add', 'label.fc-upload-prompt', '.pk-upload-prompt']],
  ['占位主文案', ['.free-upload-add span', '.fc-upload-prompt span']],
  ['占位副文案', ['.free-upload-add small', '.fc-upload-prompt small']],
  ['提示词label', ['.free-prompt-label-row span', '.fc-prompt-label-row > span']],
  ['工具按钮', ['.free-prompt-tools button', '.fc-prompt-tool-btn']],
  ['结果空态标题', ['.free-empty-preview h3', '.pk-preview-inner h3', '.pk-empty-title']],
  ['结果空态副文', ['.free-empty-preview p', '.pk-preview-inner p']],
  ['actions容器', ['.free-actions', '.fc-actions']],
  ['提交区', ['.free-submit-area', '.pk-submit-actions']],
  ['表单主卡', ['.free-main-card', '.pk-config-card']],
  ['上传section', ['.free-upload-section', '.pk-section']],
  ['结果面板', ['.free-result-panel', '.pk-result-pane']],
];

const b = await chromium.launch({ executablePath: EXEC });
const rows = {};

for (const kind of ['ref', 'local']) {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
  const page = await ctx.newPage();
  await page.goto(TARGETS[kind], { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(5000);

  for (const [name, sels] of PICK) {
    const res = await page.evaluate((sels) => {
      for (const sel of sels) {
        const el = document.querySelector(sel);
        if (!el) continue;
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        const strong = el.querySelector('strong, span');
        const scs = strong ? getComputedStyle(strong) : null;
        return {
          sel,
          box: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
          text: (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40),
          fs: cs.fontSize, fw: cs.fontWeight, lh: cs.lineHeight, ls: cs.letterSpacing,
          color: cs.color, bg: cs.backgroundColor, bgi: cs.backgroundImage.slice(0, 80),
          radius: cs.borderRadius, padding: cs.padding, margin: cs.margin, gap: cs.gap,
          border: cs.border, boxShadow: cs.boxShadow, opacity: cs.opacity,
          display: cs.display, flexDirection: cs.flexDirection, alignItems: cs.alignItems,
          justifyContent: cs.justifyContent,
          innerTag: strong ? strong.tagName : '',
          innerFs: scs ? scs.fontSize : '', innerFw: scs ? scs.fontWeight : '',
          innerLh: scs ? scs.lineHeight : '', innerColor: scs ? scs.color : '',
          html: el.outerHTML.slice(0, 300),
        };
      }
      return null;
    }, sels);
    rows[`${kind}|${name}`] = res;
  }
  await ctx.close();
}
await b.close();

const keys = PICK.map(([n]) => n);
console.log('══════ 逐节点 ref vs local ══════\n');
for (const k of keys) {
  const r = rows[`ref|${k}`], l = rows[`local|${k}`];
  console.log(`▌${k}`);
  if (!r) console.log('   ref  : (未找到)');
  else console.log(`   ref  : [${r.sel}] box=${r.box.join(',')} text="${r.text}" fs=${r.fs} fw=${r.fw} lh=${r.lh} ls=${r.ls} c=${r.color} bg=${r.bg} bgi=${r.bgi} r=${r.radius} p=${r.padding} m=${r.margin} gap=${r.gap} bd=${r.border} sh=${r.boxShadow} op=${r.opacity} | inner(${r.innerTag}) fs=${r.innerFs} fw=${r.innerFw} lh=${r.innerLh} c=${r.innerColor}`);
  if (!l) console.log('   local: (未找到)');
  else console.log(`   local: [${l.sel}] box=${l.box.join(',')} text="${l.text}" fs=${l.fs} fw=${l.fw} lh=${l.lh} ls=${l.ls} c=${l.color} bg=${l.bg} bgi=${l.bgi} r=${l.radius} p=${l.padding} m=${l.margin} gap=${l.gap} bd=${l.border} sh=${l.boxShadow} op=${l.opacity} | inner(${l.innerTag}) fs=${l.innerFs} fw=${l.innerFw} lh=${l.innerLh} c=${l.innerColor}`);
  console.log();
}