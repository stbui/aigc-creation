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
// 语义别名
for (const [k, v] of [...defs]) {
  if (v.startsWith('var(')) {
    const t = /var\((--[a-z0-9-]+)\)/.exec(v);
    if (t && defs.has(t[1])) defs.set(k, defs.get(t[1]));
  }
}

const lum = (hex) => {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const v = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
};
const cr = (a, b) => {
  const l1 = lum(a), l2 = lum(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
};
const resolveBg = (v) => {
  if (!v) return null;
  const m = /var\((--[a-z0-9-]+)\)/.exec(v);
  if (m && defs.has(m[1])) return defs.get(m[1]);
  if (/^#[0-9a-fA-F]{3,8}$/.test(v.trim())) return v.trim();
  return null; // gradient / rgba / transparent → 不可判定
};

const out = [];
root.walkRules((rule) => {
  const decls = {};
  rule.walkDecls((d) => { decls[d.prop] = d.value.trim(); });
  const bgRaw = decls['background'] || decls['background-color'] || null;
  const bg = resolveBg(bgRaw);
  const bgUnknown = bgRaw && !bg && !/transparent|none/i.test(bgRaw);
  rule.each((node) => {
    if (node.type !== 'decl' || node.prop !== 'color') return;
    const m = /^var\((--[a-z0-9-]+)\)$/.exec(node.value.trim());
    if (!m) return;
    const tok = m[1];
    const hex = defs.get(tok);
    if (!hex) return;
    // 背景：规则自身背景 → 否则按页面默认白底
    const eff = bg || '#ffffff';
    const r = cr(hex, eff);
    const num = parseFloat(decls['font-size'] || '16');
    const bold = /bold|[6-9]00/.test(decls['font-weight'] || '');
    const large = num >= 24 || (num >= 18.66 && bold);
    const need = large ? 3 : 4.5;
    if (r >= need) return;
    out.push({ line: node.source.start.line, tok, hex, bg: bg || '(页面白底)', r, need, fs: decls['font-size'] || '-', sel: rule.selector, unknown: bgUnknown });
  });
});

const byTok = new Map();
for (const r of out) { if (!byTok.has(r.tok)) byTok.set(r.tok, []); byTok.get(r.tok).push(r); }
console.log('== 浅底上低于 AA 的文字色令牌: ' + byTok.size + ' 个令牌 / ' + out.length + ' 处 ==\n');
for (const [tok, list] of byTok) {
  console.log(`${tok}  ${list[0].hex}  ratio=${list[0].r.toFixed(2)} need=${list[0].need}  n=${list.length}`);
  for (const r of list) console.log(`    L${r.line} [${r.fs}] bg=${r.bg}${r.unknown ? ' (背景不可判定)' : ''}  ${r.sel.replace(/\n/g, ' ')}`);
}
