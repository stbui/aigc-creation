import postcss from 'postcss';
import fs from 'node:fs';
const css = fs.readFileSync('src/styles/global.css', 'utf8');
const root = postcss.parse(css);
const toks = ['--text-8','--text-9','--text-10','--border-dot','--sku-text-14','--sku-text-15','--sku-text-16','--sku-text-17','--sku-text-18','--sku-text-19','--sku-text-20','--sku-text-21','--sku-text-22','--tool-text-2','--tool-text-3','--tool-text-4','--tool-text-5','--tool-text-6','--tool-text-7','--alp-text-8','--alp-text-9','--alp-text-10','--alp-text-11','--alp-text-12','--alp-text-13','--mif-text-sub','--mif-text-dim','--mif-text-dim-2','--mif-text-dim-3','--mif-text-dim-4','--mif-text-count','--mif-text-count-2','--mif-text-4','--mif-text-muted-btn','--mif-text-muted-btn-2','--mif-text-on-dark-2','--mif-text-accent','--mif-surface-success','--mif-surface-info','--mif-surface-error','--mif-status-failed-text','--lp-text-2','--wb-flow-expense-fg','--wb-thumb-fg','--wb-empty','--wb-status-completed','--wb-status-failed','--mum-text-3','--mup-text-4','--mup-text-5','--mup-text-success-1','--mup-text-success-2','--color-cta','--color-success','--danger-ref','--color-slate-400','--shell-text-2','--mif-resolution-option-sub'];
const props = new Map();
root.walkDecls((d) => {
  const m = /var\((--[a-z0-9-]+)\)/.exec(d.value);
  if (!m || !toks.includes(m[1])) return;
  if (!props.has(m[1])) props.set(m[1], new Set());
  props.get(m[1]).add(d.prop);
});
for (const t of toks) {
  const s = props.get(t);
  if (!s) { console.log(t.padEnd(26), '(未被使用)'); continue; }
  console.log(t.padEnd(26), [...s].join(', '));
}
