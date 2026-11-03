import postcss from 'postcss';
import fs from 'node:fs';
const css = fs.readFileSync('src/styles/global.css', 'utf8');
const root = postcss.parse(css);
const want = process.argv.slice(2);
root.walkRules((rule) => {
  const decls = {};
  rule.walkDecls((d) => { decls[d.prop] = d.value.trim(); });
  rule.each((node) => {
    if (node.type !== 'decl' || node.prop !== 'color') return;
    const m = /^var\((--[a-z0-9-]+)\)$/.exec(node.value.trim());
    if (!m || !want.includes(m[1])) return;
    const fs_ = decls['font-size'] || '-';
    const bg = decls['background'] || decls['background-color'] || '-';
    console.log(`${m[1]}  L${node.source.start.line}  fs=${fs_}  bg=${bg}`);
    console.log(`      ${rule.selector.replace(/\n/g, ' ')}`);
  });
});
