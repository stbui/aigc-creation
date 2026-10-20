/**
 * 关键节点盒模型对拍 —— 抽主干容器/表单区块的 box + 关键 style, ref vs local 并排。
 * 用法: node boxes.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), 'out');
const ref = JSON.parse(readFileSync(join(OUT, 'ref-tree.json'), 'utf8'));
const loc = JSON.parse(readFileSync(join(OUT, 'local-tree.json'), 'utf8'));

/** 深度优先找出所有满足谓词的节点 */
function find(node, pred, acc = []) {
  if (!node) return acc;
  if (pred(node)) acc.push(node);
  for (const k of node.kids || []) find(k, pred, acc);
  return acc;
}

const hasText = (t) => (n) => (n.text || '').includes(t);
const all = (t) => (n) => t.some((x) => (n.text || '') === x || (n.text || '').includes(x));

const TARGETS = [
  ['上传参考图标题', all(['上传参考图'])],
  ['上传占位主文案', all(['点击、拖拽或粘贴参考图片到此处上传'])],
  ['上传副文案(限制)', (n) => (n.text || '').includes('最多可上传')],
  ['提示词label', all(['创作提示词', '*创作提示词'])],
  ['AI润色', all(['AI润色'])],
  ['图片转提示词', all(['图片转提示词'])],
  ['结果空态标题', all(['效果图预览'])],
  ['结果空态副文', all(['提交任务后，生成结果将在此处展示'])],
];

const fmt = (n) => {
  if (!n) return '(缺失)';
  const s = n.style || {};
  return `box=${n.box.join(',')} fs=${s.fontSize || '-'} lh=${s.lineHeight || '-'} fw=${s.fontWeight || '-'} color=${s.color || '-'} bg=${s.backgroundColor || '-'} radius=${s.borderRadius || '-'} pad=${s.padding || '-'} gap=${s.gap || '-'} flex=${s.flexDirection || '-'}`;
};

console.log('══════ 关键节点盒模型对拍 (1440x900) ══════');
for (const [name, pred] of TARGETS) {
  const r = find(ref, pred)[0];
  const l = find(loc, pred)[0];
  console.log(`\n▌${name}`);
  console.log('  ref  : ' + fmt(r));
  console.log('  local: ' + fmt(l));
}

console.log('\n══════ 主干容器宽度对比 (top-8 最宽可见块) ══════');
const wide = (t) => find(t, (n) => n.box[2] > 300 && n.box[3] > 100).slice(0, 14);
const fr = wide(ref), fl = wide(loc);
const w = (n) => `${n.tag}.${(n.cls || '').split(' ').slice(0, 3).join('.')} → ${n.box.join(',')}`;
console.log('-- ref --'); fr.forEach((n) => console.log('   ' + w(n)));
console.log('-- local --'); fl.forEach((n) => console.log('   ' + w(n)));

console.log('\n══════ 提交区/高级设置条对比 ══════');
for (const t of ['高级设置', '登录免费生图', '登录免费生成']) {
  const r = find(ref, (n) => (n.text || '').includes(t))[0];
  const l = find(loc, (n) => (n.text || '').includes(t))[0];
  if (r || l) {
    console.log(`\n▌${t}`);
    console.log('  ref  : ' + fmt(r));
    console.log('  local: ' + fmt(l));
  }
}