import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { auditNamedImports, PROJECT_ROOT } from '../../../test/namedImportAudit';

/**
 * C 端目录的具名导入 / 导出对账。
 *
 * 后台在 2026-10-30 出过一次真实故障：`AdminDashboardPage` 从 `AdminWidgets`
 * import 了 `AdminPageLoading`，而 BoardUI 版再导出没有这个名字 —— 浏览器里是
 * ESM 链接失败，整块 `/admin` 白屏，连骨架都不出。
 *
 * 这种错**单文件转译看不出来**（esbuild / tsc 单文件只校验语法），Vitest 也看不出来：
 * Vite 把具名导入改写成对命名空间的属性访问，缺失的名字只会是 `undefined`，不会报错。
 * 所以这里直接读源码做对账：凡 `import { A, B } from './相对路径'` 的每个名字，
 * 都必须能在目标模块的导出里找到。
 *
 * C 端同样有白屏风险：`product-detail/` 这类多文件功能目录按分层约定拆成
 * 「入口文件 + 业务组件」后，一个名字写错就是整页白屏，没有兜底。
 *
 * 判据实现与后台共用 `src/test/namedImportAudit.ts` —— 两边的故障形态相同。
 */

const ROOTS = [
  'src/pages/product-detail',
  'src/components',
  'src/hooks',
  'src/lib',
  'src/context',
];

describe('C 端具名导入', () => {
  it('每条相对导入的名字都能在目标模块里找到', () => {
    const roots = ROOTS.map((root) => resolve(PROJECT_ROOT, root));
    const failures = auditNamedImports(roots);

    expect(failures).toEqual([]);
  });
});
