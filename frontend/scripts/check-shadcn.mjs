/**
 * 检查 shadcn 原子件与组合约定。
 *
 * 这些约定在开发态都不明显，但会分别造成暗色主题串色、自定义 token
 * 冲突合并失效，以及 Select / Dropdown / Command 的键盘与读屏语义缺失。
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from '@babel/parser';

const UI_DIR = 'src/admin-ui/components/ui';
const SOURCE_DIR = 'src';
const errors = [];

for (const file of readdirSync(UI_DIR).filter((name) => name.endsWith('.tsx'))) {
  const path = join(UI_DIR, file);
  const source = readFileSync(path, 'utf8');

  if (/^import[ \t]*\{[ \t]*cn[ \t]*\}[ \t]*from[ \t]*(['"])cn\1/m.test(source)) {
    errors.push(`${path}: 使用了官方默认 cn，请运行 node scripts/post-shadcn.mjs`);
  }

  if (/\bdark:[^\s"'`]+/.test(source)) {
    errors.push(`${path}: 仍包含 dark: 变体，请运行 node scripts/post-shadcn.mjs`);
  }
}

function walkFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return walkFiles(path);
    return entry.isFile() && entry.name.endsWith('.tsx') ? [path] : [];
  });
}

const compositionRules = [
  { item: 'SelectItem', group: 'SelectGroup' },
  { item: 'DropdownMenuItem', group: 'DropdownMenuGroup' },
  { item: 'CommandItem', group: 'CommandGroup' },
];

for (const path of walkFiles(SOURCE_DIR)) {
  if (path.endsWith('.test.tsx')) continue;

  const source = readFileSync(path, 'utf8');
  let ast;
  try {
    ast = parse(source, {
      sourceType: 'module',
      plugins: ['jsx', 'typescript'],
      errorRecovery: true,
    });
  } catch (error) {
    errors.push(`${path}: 无法解析 TSX（${error.message}）`);
    continue;
  }

  const jsxAncestors = [];

  const visit = (node, ancestors) => {
    if (!node || typeof node !== 'object') return;

    let nextAncestors = ancestors;
    if (node.type === 'JSXElement') {
      const tagName = getJsxTagName(node.openingElement.name);
      const shortName = tagName.split('.').at(-1);
      const rule = compositionRules.find(({ item }) => item === shortName);
      const parentTag = ancestors.at(-1);

      if (rule && parentTag !== rule.group) {
        errors.push(
          `${path}:${node.loc?.start.line ?? 1}: <${tagName}> 必须直接放在 <${rule.group}> 内（当前父级：${parentTag ?? '无'}）`,
        );
      }

      // Fragment 不产生 DOM 节点，不改变组合层级。
      if (shortName !== 'Fragment') nextAncestors = [...ancestors, tagName];
    }

    for (const [key, value] of Object.entries(node)) {
      if (['loc', 'start', 'end', 'extra', 'comments', 'tokens', 'errors'].includes(key)) continue;
      if (Array.isArray(value)) {
        for (const child of value) visit(child, nextAncestors);
      } else if (value && typeof value === 'object' && typeof value.type === 'string') {
        visit(value, nextAncestors);
      }
    }
  };

  visit(ast, jsxAncestors);
}

function getJsxTagName(node) {
  if (node.type === 'JSXIdentifier') return node.name;
  if (node.type === 'JSXNamespacedName') {
    return `${getJsxTagName(node.namespace)}:${getJsxTagName(node.name)}`;
  }
  if (node.type === 'JSXMemberExpression') {
    return `${getJsxTagName(node.object)}.${getJsxTagName(node.property)}`;
  }
  return 'Unknown';
}

if (errors.length > 0) {
  console.error('shadcn 源码检查失败：');
  for (const error of errors) console.error(`  - ${error}`);
  process.exitCode = 1;
} else {
  console.log('shadcn 源码检查通过');
}
