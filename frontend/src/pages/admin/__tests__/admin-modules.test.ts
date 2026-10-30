import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 后台目录的具名导入 / 导出对账。
 *
 * 2026-10-30 出过一次真实故障：`AdminDashboardPage` 从 `AdminWidgets` import 了
 * `AdminPageLoading`，而 BoardUI 版再导出没有这个名字 —— 浏览器里是 ESM 链接失败，
 * 整块 `/admin` 白屏，连骨架都不出。
 *
 * 这种错**单文件转译看不出来**（esbuild / tsc 单文件只校验语法），Vitest 也看不出来：
 * Vite 把具名导入改写成对命名空间的属性访问，缺失的名字只会是 `undefined`，不会报错。
 * 所以这里直接读源码做对账：凡 `import { A, B } from './相对路径'` 的每个名字，
 * 都必须能在目标模块的导出里找到。
 */

const ROOTS = ['src/admin-ui', 'src/components/admin', 'src/pages/admin'];
const EXTENSIONS = ['', '.ts', '.tsx', '.d.ts', '/index.ts', '/index.tsx'];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry !== '__tests__') walk(full, out);
      continue;
    }
    if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

function resolveModule(fromFile: string, specifier: string): string | null {
  const base = resolve(dirname(fromFile), specifier);
  for (const ext of EXTENSIONS) {
    const candidate = base + ext;
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

const exportCache = new Map<string, Set<string>>();

/** 收集一个模块对外暴露的名字：声明式导出、`export {}`、`export * from`、`export {} from` */
function exportsOf(file: string): Set<string> {
  const cached = exportCache.get(file);
  if (cached) return cached;

  const source = readFileSync(file, 'utf8');
  const names = new Set<string>();
  const add = (raw: string) => {
    // `A as B` 对外暴露的是 B
    const alias = raw.trim().split(/\s+as\s+/);
    const name = (alias[1] ?? alias[0]).replace(/^type\s+/, '').trim();
    if (name) names.add(name);
  };

  for (const match of source.matchAll(
    /export\s+(?:declare\s+)?(?:abstract\s+)?(?:const|function|class|let|var|interface|type|enum)\s+([A-Za-z0-9_$]+)/g,
  )) {
    names.add(match[1]);
  }
  for (const match of source.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}(?!\s*from)/g)) {
    match[1].split(',').forEach(add);
  }
  for (const match of source.matchAll(/export\s+\*\s+from\s+['"]([^'"]+)['"]/g)) {
    const target = resolveModule(file, match[1]);
    if (target) for (const name of exportsOf(target)) names.add(name);
  }
  for (const match of source.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}\s+from\s+['"]([^'"]+)['"]/g)) {
    match[1].split(',').forEach(add);
  }
  if (/export\s+default/.test(source)) names.add('default');

  exportCache.set(file, names);
  return names;
}

describe('后台具名导入', () => {
  it('每条相对导入的名字都能在目标模块里找到', () => {
    const failures: string[] = [];

    for (const root of ROOTS) {
      for (const file of walk(root)) {
        const source = readFileSync(file, 'utf8');
        for (const match of source.matchAll(/import\s+(?:type\s+)?\{([^}]+)\}\s+from\s+['"](\.[^'"]+)['"]/g)) {
          const target = resolveModule(file, match[2]);
          if (!target) {
            failures.push(`${file}: 无法解析 ${match[2]}`);
            continue;
          }
          const available = exportsOf(target);
          for (const raw of match[1].split(',')) {
            const name = raw.trim().split(/\s+as\s+/)[0].replace(/^type\s+/, '').trim();
            if (name && !available.has(name)) {
              failures.push(`${file}: ${match[2]} 没有导出 ${name}`);
            }
          }
        }
      }
    }

    expect(failures).toEqual([]);
  });
});
