/**
 * shadcn registry 取件脚本（一次性工具，不进产物）。
 *
 * 用途：从 ui.shadcn.com 的 registry 拉取 new-york-v4 组件源码，落到
 * `src/admin-ui/components/ui/`，并做三处本项目化改写：
 *
 *  ① `from "cn"` → `from "~/admin-ui/lib/cn"`（本项目用自己的 cn，别装 npm 的 cn 包）
 *  ② 剥掉 `dark:` 变体 —— 本项目全站无暗色模式（global.css 无 dark 块，
 *     BoardUI 的 `.dark` 类从未启用），而 Tailwind v4 的 `dark:` 默认是
 *     `prefers-color-scheme: media`：系统开暗色时 shadcn 组件会变暗、
 *     全站不变，直接破版。
 *  ③ 头部加来源与改动说明注释（vendor 目录外的自持组件，需可追溯）
 *
 * 用法：node scripts/fetch-shadcn.mjs <component> [...]
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

const OUT_DIR = 'src/admin-ui/components/ui';
const REGISTRY = 'https://ui.shadcn.com/r/styles/new-york-v4';

/**
 * 剥掉 class 字符串里的 `dark:` 变体。
 *
 * 必须**整枚 token 删除**，不能只删 `dark:` 前缀：只删前缀会让原本
 * 「仅暗色生效」的声明变成无条件生效，与前面的类直接冲突。例如 button 的
 * destructive 变体上游是
 *   "bg-destructive ... focus-visible:ring-destructive/20 dark:bg-destructive/60 ..."
 * 只删前缀会得到 "bg-destructive ... bg-destructive/60" —— 后者赢，
 * 亮色下按钮变成半透明。
 *
 * token 边界是空白或引号；`dark:focus-visible:ring-x` 是单枚 token，一并删掉。
 */
function stripDarkVariants(content) {
  return content
    .replace(/\bdark:[^\s"'`]+/g, '')
    // 删完留下的多余空格与「空格 + 换行」压回单空格，避免类名里出现空洞
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+\n/g, '\n');
}

/** 把 registry 的 import 指向改成本项目路径 */
function rewriteImports(content) {
  return content
    .replace(/from ["']cn["']/g, 'from "~/admin-ui/lib/cn"')
    // registry 内部互引：`@/registry/new-york-v4/ui/button` → 同目录相对路径。
    // 不能保留 `@/...`：`@` 别名指向 BoardUI vendor 根，会解析到
    // `src/vendor/boardui/registry/...`（不存在），构建直接失败。
    .replace(/from ["']@\/registry\/new-york-v4\/ui\/([a-z-]+)["']/g, 'from "./$1"')
    .replace(/from ["']radix-ui["']/g, 'from "radix-ui"');
}

function addHeader(name, content) {
  const header = `/**
 * ${name} —— shadcn/ui (new-york-v4) 组件，自持副本。
 *
 * 来源：https://ui.shadcn.com/r/styles/new-york-v4/${name}.json
 *
 * 相对上游的改动：
 *   - \`from "cn"\` → \`from "~/admin-ui/lib/cn"\`（用项目自有的类名合并，
 *     与 BoardUI vendor 共用同一份 tailwind-merge 规则）
 *   - 剥掉全部 \`dark:\` 变体：本项目全站无暗色模式，而 Tailwind v4 的
 *     \`dark:\` 默认走 \`prefers-color-scheme: media\`，系统开暗色时只有
 *     shadcn 组件变暗，会破版
 */
`;
  return header + content;
}

const names = process.argv.slice(2);
if (names.length === 0) {
  console.error('用法: node scripts/fetch-shadcn.mjs <component> [...]');
  process.exit(1);
}

mkdirSync(OUT_DIR, { recursive: true });

for (const name of names) {
  const res = await fetch(`${REGISTRY}/${name}.json`);
  if (!res.ok) {
    console.error(`${name}: HTTP ${res.status}`);
    process.exit(1);
  }
  const entry = await res.json();
  const file = entry.files?.[0];
  if (!file) {
    console.error(`${name}: registry 无文件`);
    process.exit(1);
  }
  let content = stripDarkVariants(file.content);
  content = rewriteImports(content);
  content = addHeader(name, content);
  const target = join(OUT_DIR, `${name}.tsx`);
  writeFileSync(target, content, 'utf8');
  console.log(`${name} → ${target}`);
}
