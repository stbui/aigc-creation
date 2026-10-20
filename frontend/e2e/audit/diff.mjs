/**
 * ref vs local 结构对拍 —— 只比可复现事实（文案 / 交互元素签名 / 关键盒模型）。
 * 用法: node diff.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), 'out');
const ref = JSON.parse(readFileSync(join(OUT, 'ref-inventory.json'), 'utf8'));
const loc = JSON.parse(readFileSync(join(OUT, 'local-inventory.json'), 'utf8'));

const line = (s) => console.log(s);
const pad = (s, n) => String(s ?? '').padEnd(n);

line('══════ 1. 文案清单 (ref → local 命中/缺失) ══════');
const norm = (t) => t.replace(/\s+/g, '');
const locSet = new Set(loc.texts.map(norm));
const refSet = new Set(ref.texts.map(norm));
let missing = [], extra = [];
for (const t of ref.texts) if (!locSet.has(norm(t))) missing.push(t);
for (const t of loc.texts) if (!refSet.has(norm(t))) extra.push(t);
line(`ref 唯一文案 ${refSet.size} / local ${locSet.size}  |  ref有local无 ${missing.length} / local有ref无 ${extra.length}`);
line('\n-- ref 有 / local 无 --');
missing.forEach((t) => line('  ✗ ' + t));
line('\n-- local 有 / ref 无 --');
extra.forEach((t) => line('  + ' + t));

line('\n══════ 2. 交互元素签名对比 ══════');
const sig = (bs) => bs.map((b) => `${b.text}|${b.box[2]}x${b.box[3]}|${b.bg}|${b.color}|${b.radius}|${b.disabled ? 'dis' : 'en'}`);
const refBtns = new Set(sig(ref.buttons));
const locBtns = new Set(sig(loc.buttons));
line(`ref 按钮 ${ref.buttons.length} / local ${loc.buttons.length}`);
line('\n-- ref 按钮 (全部) --');
ref.buttons.forEach((b) => line(`  ${pad(b.text, 14)} ${pad(b.box[2] + 'x' + b.box[3], 10)} @${pad(b.box.join(','), 20)} bg=${pad(b.bg, 22)} c=${pad(b.color, 22)} r=${pad(b.radius, 10)} ${b.disabled ? 'DISABLED' : ''}`));
line('\n-- 仅 local 有的按钮 --');
loc.buttons.filter((b) => !refBtns.has(sig([b])[0])).forEach((b) => line(`  + ${pad(b.text, 14)} ${pad(b.box[2] + 'x' + b.box[3], 10)} @${pad(b.box.join(','), 20)} bg=${pad(b.bg, 22)} c=${pad(b.color, 22)}`));

line('\n══════ 3. 输入控件对比 ══════');
const fmtIn = (a) => a.map((i) => `${i.tag}${i.type ? '[' + i.type + ']' : ''} rows=${i.rows} maxlen=${i.maxlength} ${i.box[2]}x${i.box[3]} @${i.box.join(',')} ph="${i.placeholder}"`);
line('-- ref --'); fmtIn(ref.inputs).forEach((s) => line('  ' + s));
line('-- local --'); fmtIn(loc.inputs).forEach((s) => line('  ' + s));

line('\n══════ 4. 可见图片对比 ══════');
line(`ref imgs=${ref.imgs.length} svg=${ref.svgCount} | local imgs=${loc.imgs.length} svg=${loc.svgCount}`);
ref.imgs.forEach((i) => line(`  ref  ${pad(i.box[2] + 'x' + i.box[3], 10)} @${pad(i.box.join(','), 20)} ${i.src.slice(0, 60)}`));
loc.imgs.forEach((i) => line(`  loc  ${pad(i.box[2] + 'x' + i.box[3], 10)} @${pad(i.box.join(','), 20)} ${i.src.slice(0, 60)}`));

line('\n══════ 5. title/url ══════');
line(`ref: ${ref.title} | ${ref.url}`);
line(`loc: ${loc.title} | ${loc.url}`);