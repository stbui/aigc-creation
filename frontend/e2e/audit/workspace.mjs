/**
 * 主工作区限定对拍 —— 只看 x>=180 的输入栏/结果栏节点, 排除顶部 nav 与侧边栏干扰。
 * 用法: node workspace.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), 'out');
const ref = JSON.parse(readFileSync(join(OUT, 'ref-tree.json'), 'utf8'));
const loc = JSON.parse(readFileSync(join(OUT, 'local-tree.json'), 'utf8'));

/** 限定主工作区: x>=180 且 y>=120; 全量收集所有满足尺寸门槛的节点 */
function main(tree) {
  const acc = [];
  const walk = (n, depth) => {
    if (depth > 14) return;
    if (n.box[0] >= 180 && n.box[1] >= 120 && n.box[2] >= 100 && n.box[3] >= 12) acc.push(n);
    for (const k of n.kids || []) walk(k, depth + 1);
  };
  walk(tree, 0);
  return acc;
}

const line = (n) => {
  const s = n.style || {};
  const bits = [
    `${n.box[0]},${n.box[1]} ${n.box[2]}x${n.box[3]}`,
    s.fontSize ? `fs=${s.fontSize}` : '',
    s.lineHeight ? `lh=${s.lineHeight}` : '',
    s.fontWeight ? `fw=${s.fontWeight}` : '',
    s.color ? `c=${s.color}` : '',
    s.backgroundColor && s.backgroundColor !== 'rgba(0, 0, 0, 0)' ? `bg=${s.backgroundColor}` : '',
    s.border && s.border !== '0px none rgb(229, 231, 239)' ? `bd=${s.border}` : '',
    s.borderRadius && s.borderRadius !== '0px' ? `r=${s.borderRadius}` : '',
    s.padding && s.padding !== '0px' ? `p=${s.padding}` : '',
    s.gap && s.gap !== 'normal' ? `gap=${s.gap}` : '',
  ].filter(Boolean);
  const cls = (n.cls || '').split(' ').slice(0, 2).join('.');
  const txt = n.text ? ` «${n.text.slice(0, 34)}»` : '';
  return `${n.tag}${cls ? '.' + cls : ''} ${bits.join(' ')}${txt}`;
};

const dedupe = (arr) => {
  const seen = new Set();
  return arr.filter((n) => {
    const k = n.box.join(',') + '|' + (n.text || '') + '|' + (n.cls || '');
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
};

console.log('══════ REF 主工作区节点 (x>=180, y>=120, w>=100, h>=12) ══════');
dedupe(main(ref)).forEach((n) => console.log('  ' + line(n)));

console.log('\n══════ LOCAL 主工作区节点 (x>=180, y>=120, w>=100, h>=12) ══════');
dedupe(main(loc)).forEach((n) => console.log('  ' + line(n)));