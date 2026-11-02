/**
 * shadcn 组件装完后的项目化处理。**每次 `npx shadcn add` 之后都必须跑一次。**
 *
 * 做三件事，对应三条「装的时候顺手就破、破了自己看不出来」的约定：
 *
 * ## ① 剥掉 `dark:` 变体
 *
 * 本项目全站无暗色模式（`global.css` 只有一套 `:root`）。Tailwind v4 的 `dark:`
 * 默认走 `prefers-color-scheme: media` —— 系统开暗色时**只有 shadcn 组件变暗**，
 * 全站其余部分不变，按钮与浮层在浅色页面里突然变深。这类问题只在用户系统切暗色
 * 时才出现，开发期几乎看不到。
 *
 * 必须**整枚 token 删除**，不能只删前缀：只删前缀会让原本「仅暗色生效」的声明变成
 * 无条件生效。例如上游 destructive 按钮是
 *   `bg-destructive ... dark:bg-destructive/60`
 * 只删前缀得到 `bg-destructive ... bg-destructive/60`，后者赢，亮色下按钮变半透明。
 * token 边界是空白或引号，`dark:focus-visible:ring-x` 作为单枚 token 一并删掉。
 *
 * ## ② 把 `cn` 的导入改指项目出口
 *
 * 官方注册表的组件源码固定写 `import { cn } from "cn"`，用的是**默认合并表**。
 * 项目的 `cn` 在 `admin-ui/lib/cn.ts` 里用 `createCn` 补登了 `@theme` 自造的
 * token（`shadow-card` 等），不补登的话同名不同值的类不会被判成冲突、两者并存。
 * 这里统一改写指向，让全站只有一张合并表。
 *
 * ## ③ 圆角档位体检（只告警，不改源码）
 *
 * 项目把 Tailwind 的 radius 命名空间重映射到自己的五档（见 `styles/admin.css`）：
 * `rounded-sm` 4px / `rounded-md` 8px / `rounded-lg` 12px / `rounded-xl` 16px。
 * 控件（按钮 / 输入框 / 文本域 / 下拉触发器）必须是 `rounded-md`；上游换成
 * `rounded-lg` 就会在同一张表单里出现 12px 与 8px 两套圆角。
 *
 * ## 用法
 *
 *   node scripts/post-shadcn.mjs            # 处理 components/ui 下全部
 *   node scripts/post-shadcn.mjs button     # 只处理指定组件
 */

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const UI_DIR = 'src/admin-ui/components/ui';
const CN_IMPORT = "import { cn } from '~/admin-ui/lib/cn'"; // 保持与上游一致的无分号风格

/** 必须落在控件档（`rounded-md` = 8px）的文件。 */
const CONTROL_FILES = new Set([
  'button.tsx',
  'input.tsx',
  'textarea.tsx',
  'select.tsx',
  'popover.tsx',
  'dropdown-menu.tsx',
]);

/**
 * 整枚删除 `dark:` token。
 *
 * **只在字符串字面量内部动手**：`dark:` 只可能出现在类名里，而空白折叠必须
 * 限定在同一个字符串内 —— 对整份源码做 `[ \t]{2,} → ' '` 会把 JSX 缩进压成
 * 一列，文件能跑但读不了。
 */
function stripDarkVariants(content) {
  return content.replace(/(["'`])((?:\\.|(?!\1)[^\\\n])*)\1/g, (whole, quote, body) => {
    if (!body.includes('dark:')) return whole;
    const cleaned = body
      .replace(/\bdark:[^\s"'`]+/g, '')
      .replace(/[ \t]{2,}/g, ' ')
      .trim();
    return `${quote}${cleaned}${quote}`;
  });
}

/**
 * `from "cn"` / `from 'cn'` → 项目出口；`cn/config` 与 `{ twMerge }` 等不受影响。
 *
 * 按**整行**匹配并在行内结束（`[ \t]*$` 不跨行），否则会把换行一并吃掉，
 * 下一个 `function` 会黏在 import 后面。
 */
function rewriteCnImport(content) {
  return content.replace(
    /^import[ \t]*\{[ \t]*cn[ \t]*\}[ \t]*from[ \t]*(['"])cn\1[ \t]*;?[ \t]*$/gm,
    CN_IMPORT,
  );
}

const argv = process.argv.slice(2);
const targets = argv.length
  ? argv
  : readdirSync(UI_DIR)
      .filter((f) => f.endsWith('.tsx') && f !== 'index.tsx')
      .map((f) => f.replace(/\.tsx$/, ''));

let touched = 0;
const radiusWarnings = [];

for (const name of targets) {
  const file = join(UI_DIR, `${name}.tsx`);
  let source;
  try {
    source = readFileSync(file, 'utf8');
  } catch {
    console.warn(`跳过：找不到 ${file}`);
    continue;
  }

  const next = rewriteCnImport(stripDarkVariants(source));
  if (next !== source) {
    writeFileSync(file, next);
    touched += 1;
    console.log(`${name} → 已处理`);
  }

  if (CONTROL_FILES.has(`${name}.tsx`) && /\brounded-lg\b/.test(next)) {
    radiusWarnings.push(`${name}.tsx`);
  }
}

console.log(`\n完成：${touched} 个文件改动（处理 ${targets.length} 个）`);

if (radiusWarnings.length) {
  console.warn(
    `\n⚠ 控件档圆角告警（应为 rounded-md = 8px，实际出现 rounded-lg = 12px）：\n  ${radiusWarnings.join('\n  ')}`,
  );
}
