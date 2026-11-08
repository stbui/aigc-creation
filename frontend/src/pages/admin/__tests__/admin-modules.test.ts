import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { auditNamedImports, PROJECT_ROOT } from '../../../test/namedImportAudit';

/**
 * 后台目录的具名导入 / 导出对账。
 *
 * 2026-10-30 出过一次真实故障：`AdminDashboardPage` 从共享控件 barrel import 了
 * `AdminPageLoading`，而那一版 barrel 没有再导出这个名字 —— 浏览器里是 ESM 链接失败，
 * 整块 `/admin` 白屏，连骨架都不出。
 *
 * 这种错**单文件转译看不出来**（esbuild / tsc 单文件只校验语法），Vitest 也看不出来：
 * Vite 把具名导入改写成对命名空间的属性访问，缺失的名字只会是 `undefined`，不会报错。
 * 所以这里直接读源码做对账：凡 `import { A, B } from './相对路径'` 的每个名字，
 * 都必须能在目标模块的导出里找到。
 *
 * 判据实现与 C 端共用 `src/test/namedImportAudit.ts` —— 两边的故障形态相同。
 */

const ROOTS = ['src/admin-ui', 'src/components/admin', 'src/pages/admin'];

describe('后台具名导入', () => {
  it('每条相对导入的名字都能在目标模块里找到', () => {
    const roots = ROOTS.map((root) => resolve(PROJECT_ROOT, root));
    const failures = auditNamedImports(roots);

    expect(failures).toEqual([]);
  });
});

describe('审计页交互边界', () => {
  it('审计只留痕，不承载任何确认交互', () => {
    const source = readFileSync(
      resolve(PROJECT_ROOT, 'src/pages/admin/audit-logs/page.tsx'),
      'utf8',
    );

    expect(source).not.toMatch(
      /\b(?:ConfirmDialog|useConfirm|useDiscardConfirm|useUnsavedGuard|window\.confirm)\b/,
    );
  });
});
