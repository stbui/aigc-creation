import postcss from 'postcss';
import fs from 'node:fs';
const css = fs.readFileSync('src/styles/global.css', 'utf8');
const root = postcss.parse(css);
const defs = new Map();
root.walkRules((r) => { if (!/^:root\b/.test(r.selector)) return; r.walkDecls((d) => { if (d.prop.startsWith('--') && /^#[0-9a-fA-F]{3,8}$/.test(d.value.trim())) defs.set(d.prop, d.value.trim()); }); });
const lum = (hex) => { let h = hex.replace('#',''); if (h.length===3) h = h.split('').map(c=>c+c).join(''); const v=[0,2,4].map(i=>parseInt(h.slice(i,i+2),16)/255).map(c=>c<=0.03928?c/12.92:((c+0.055)/1.055)**2.4); return .2126*v[0]+.7152*v[1]+.0722*v[2]; };
const cr=(a,b)=>{const l1=lum(a),l2=lum(b);return (Math.max(l1,l2)+.05)/(Math.min(l1,l2)+.05);};
const use = new Map();
root.walkDecls((d) => { const m=/^var\((--[a-z0-9-]+)\)$/.exec(d.value.trim()); if(!m) return; if(!use.has(m[1])) use.set(m[1],[]); use.get(m[1]).push({line:d.source.start.line, prop:d.prop}); });
const fams = {
  'text': /--text-(\d+)$/, 'sku-text': /--sku-text-(\d+)$/, 'tool-text': /--tool-text-(\d+)$/,
  'alp-text': /--alp-text-(\d+)$/, 'mif-text': /--mif-text-([\w-]+)$/, 'mup-text': /--mup-text-([\w-]+)$/,
};
for (const [fam, re] of Object.entries(fams)) {
  console.log('\n=== ' + fam + ' ===');
  const rows = [...defs].filter(([k])=>re.test(k)).sort((a,b)=>+re.exec(a[0])[1]-+re.exec(b[0])[1]);
  for (const [k,v] of rows) {
    const n = (use.get(k)||[]).length;
    console.log(`  ${k.padEnd(26)} ${v}  vs#fff=${cr(v,'#ffffff').toFixed(2).padStart(5)}  uses=${n}`);
  }
}
