import postcss from 'postcss';
import fs from 'node:fs';

const css = fs.readFileSync('src/styles/global.css', 'utf8');
const root = postcss.parse(css);

const defs = new Map();
root.walkRules((r) => {
  if (!/^:root\b/.test(r.selector)) return;
  r.walkDecls((d) => {
    if (d.prop.startsWith('--') && /^#[0-9a-fA-F]{3,8}$/.test(d.value.trim())) defs.set(d.prop, d.value.trim());
  });
});
for (const [k, v] of [...defs]) {
  if (v.startsWith('var(')) { const t = /var\((--[a-z0-9-]+)\)/.exec(v); if (t && defs.has(t[1])) defs.set(k, defs.get(t[1])); }
}
const lum = (hex) => {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const v = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
};
const cr = (a, b) => { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };

// 令牌 → 使用点 (含背景)
const usage = new Map();
root.walkRules((rule) => {
  const decls = {};
  rule.walkDecls((d) => { decls[d.prop] = d.value.trim(); });
  rule.each((node) => {
    if (node.type !== 'decl' || node.prop !== 'color') return;
    const m = /^var\((--[a-z0-9-]+)\)$/.exec(node.value.trim());
    if (!m) return;
    const tok = m[1];
    if (!defs.has(tok)) return;
    const bgRaw = decls['background'] || decls['background-color'] || null;
    if (!usage.has(tok)) usage.set(tok, []);
    usage.get(tok).push({ line: node.source.start.line, bgRaw, fs: decls['font-size'] || '-', sel: rule.selector.replace(/\n/g, ' ') });
  });
});

// 分类: 排除 纯白文字 / 极浅色 (它们多用于深底)
const WHITEISH = ['#ffffff', '#ffffffe6', '#ffffffd1', '#ffffffd6', '#ffffffb3'];
const out = [];
for (const [tok, list] of usage) {
  const hex = defs.get(tok);
  if (WHITEISH.includes(hex.toLowerCase())) continue;
  const L = lum(hex);
  if (L > 0.72) continue;   // 极浅 → 基本是深底上的文字
  // 判断是否有深底使用
  let darkUse = false, lightBgs = new Set();
  for (const u of list) {
    const b = u.bgRaw || '';
    if (!b) { lightBgs.add('#ffffff'); continue; }
    const mm = /var\((--[a-z0-9-]+)\)/.exec(b);
    if (mm && defs.has(mm[1])) {
      const bh = defs.get(mm[1]);
      if (lum(bh) < 0.35) darkUse = true; else lightBgs.add(bh);
      continue;
    }
    if (/^#[0-9a-fA-F]{3,8}$/.test(b)) { const bh = b; if (lum(bh) < 0.35) darkUse = true; else lightBgs.add(bh); continue; }
    // rgba/gradient 不可判定 → 记为未知
    lightBgs.add('?');
  }
  const known = [...lightBgs].filter((x) => x !== '?');
  const worstBg = known.length ? known.sort((a, b) => lum(b) - lum(a))[0] : '#ffffff';
  const ratio = cr(hex, worstBg);
  const need = 4.5;
  if (ratio >= need) continue;
  out.push({ tok, hex, ratio, worstBg, darkUse, unknown: lightBgs.has('?'), n: list.length, list });
}
console.log('== 候选（浅底失效 / 需定新值）==\n');
for (const r of out) {
  console.log(`${r.tok.padEnd(26)} ${r.hex}  ratio=${r.ratio.toFixed(2)}  最浅底=${r.worstBg}  深底使用=${r.darkUse ? 'YES(需单独处理)' : 'no'}  背景未知=${r.unknown ? 'Y' : 'n'}  n=${r.n}`);
}
console.log('\n合计: ' + out.length + ' 个令牌');
