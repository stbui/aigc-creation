import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 具名导入 / 导出的源码级对账工具。
 *
 * 2026-10-30 出过一次真实故障：`AdminDashboardPage` 从 `AdminWidgets` import 了
 * `AdminPageLoading`，而 BoardUI 版再导出没有这个名字 —— 浏览器里是 ESM 链接失败，
 * 整块 `/admin` 白屏，连骨架都不出。
 *
 * 这种错**单文件转译看不出来**（esbuild / tsc 单文件只校验语法），Vitest 也看不出来：
 * Vite 把具名导入改写成对命名空间的属性访问，缺失的名字只会是 `undefined`，不会报错。
 * 所以这里直接读源码做对账：凡 `import { A, B } from './相对路径'` 的每个名字，
 * 都必须能在目标模块的导出里找到。
 *
 * 后台与 C 端共用这一份实现（见 `pages/admin/__tests__/admin-modules.test.ts`
 * 与 `pages/product-detail/__tests__/product-detail-modules.test.ts`）——
 * 两边的故障形态完全相同, 判据不该有两套。
 */

/** 前端工程根目录（本文件在 `src/test/` 下, 上溯两级即工程根） */
export const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const EXTENSIONS = ['', '.ts', '.tsx', '.d.ts', '/index.ts', '/index.tsx'];

/** 递归收集目录下的 ts / tsx 文件；跳过 `__tests__` 与 `node_modules` */
export function walk(dir: string, out: string[] = []): string[] {
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

/** 解析相对导入的目标文件；解析不到返回 null */
export function resolveModule(fromFile: string, specifier: string): string | null {
  const base = resolve(dirname(fromFile), specifier);
  for (const ext of EXTENSIONS) {
    const candidate = base + ext;
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

const exportCache = new Map<string, Set<string>>();

/**
 * 去掉具名列表里的注释。
 *
 * `import type { A, /* 分组 *\/ B } from '...'` 是本项目里真实存在的写法 ——
 * `lib/api.ts` 把类型按「交易后台 (B1)」「工单 (B7)」等分组注释隔开。
 * 不剥注释的话, 注释会被当成一个导入名, 报出「types/api 没有导出 // 交易后台 (B1) AdminProduct」
 * 这种假故障。
 */
function stripComments(raw: string): string {
  return raw
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ');
}

/** 收集一个模块对外暴露的名字：声明式导出、`export {}`、`export * from`、`export {} from` */
export function exportsOf(file: string): Set<string> {
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
    /export\s+(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(?:const|function|class|let|var|interface|type|enum)\s+([A-Za-z0-9_$]+)/g,
  )) {
    names.add(match[1]);
  }
  for (const match of source.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}(?!\s*from)/g)) {
    stripComments(match[1]).split(',').forEach(add);
  }
  for (const match of source.matchAll(/export\s+\*\s+from\s+['"]([^'"]+)['"]/g)) {
    const target = resolveModule(file, match[1]);
    if (target) for (const name of exportsOf(target)) names.add(name);
  }
  for (const match of source.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}\s+from\s+['"]([^'"]+)['"]/g)) {
    stripComments(match[1]).split(',').forEach(add);
  }
  if (/export\s+default/.test(source)) names.add('default');

  exportCache.set(file, names);
  return names;
}

/** 一条对账失败 */
export interface AuditFailure {
  /** 出问题的源文件 */
  file: string;
  /** 相对导入说明 */
  detail: string;
}

/**
 * 对账一个目录树里的具名导入。
 *
 * 只查相对导入（`./x` / `../x`）—— 绝对路径与包名导入由构建器解析,
 * 缺失时报错方式与本故障不同, 不在本工具的判据内。
 */
export function auditNamedImports(roots: string[]): AuditFailure[] {
  const failures: AuditFailure[] = [];

  for (const root of roots) {
    for (const file of walk(root)) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(/import\s+(?:type\s+)?\{([^}]+)\}\s+from\s+['"](\.[^'"]+)['"]/g)) {
        const target = resolveModule(file, match[2]);
        if (!target) {
          failures.push({ file, detail: `无法解析 ${match[2]}` });
          continue;
        }
        const available = exportsOf(target);
        for (const raw of stripComments(match[1]).split(',')) {
          const name = raw.trim().split(/\s+as\s+/)[0].replace(/^type\s+/, '').trim();
          if (name && !available.has(name)) {
            failures.push({ file, detail: `${match[2]} 没有导出 ${name}` });
          }
        }
      }
    }
  }

  return failures;
}
