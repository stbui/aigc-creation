import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { auditNamedImports, PROJECT_ROOT } from '../../../test/namedImportAudit';
import { safeHelpImageUrl } from '../utils';

/**
 * 结算页的具名导入 / 导出对账。
 *
 * 与其余 C 端功能目录同因：多文件目录按分层约定拆成「入口文件 + 业务组件」后，
 * 一个名字写错就是整页白屏，而 Vite 把具名导入改写成属性访问，缺失的名字只会是
 * `undefined` —— 单文件转译与 Vitest 都不会报错。这里直接读源码对账。
 *
 * 判据实现与后台 / 其余 C 端目录共用 `src/test/namedImportAudit.ts`。
 */

const ROOTS = ['src/pages/checkout', 'src/components', 'src/hooks', 'src/lib', 'src/context'];

describe('结算页具名导入', () => {
  it('每条相对导入的名字都能在目标模块里找到', () => {
    const roots = ROOTS.map((root) => resolve(PROJECT_ROOT, root));
    const failures = auditNamedImports(roots);

    expect(failures).toEqual([]);
  });
});

describe('帮助图片 URL', () => {
  it('只允许站内路径与 http(s) 地址', () => {
    expect(safeHelpImageUrl('/uploads/help.png')).toBe('/uploads/help.png');
    expect(safeHelpImageUrl('https://cdn.example.com/help.png')).toBe(
      'https://cdn.example.com/help.png',
    );
    expect(safeHelpImageUrl('javascript:alert(1)')).toBeNull();
    expect(safeHelpImageUrl('data:image/png;base64,abc')).toBeNull();
    expect(safeHelpImageUrl('//evil.example.com/help.png')).toBeNull();
    expect(safeHelpImageUrl('/uploads\\help.png')).toBeNull();
    expect(safeHelpImageUrl('')).toBeNull();
  });
});

/*
 * C 端结算页不得回显后端原始错误。
 *
 * `providersError` 取的是 `(e as Error).message`：后端 5xx 时它还带着请求号与
 * 内部报错，属于日志与后台的内容（`docs/error-copy.md` §1 规则 4 / §7 自检）。
 * 这条约束同时落在 `hooks.ts` 与 `page.tsx`，用源码断言比 mock 整个 hook 便宜，
 * 也不会随组件重构失效 —— 与本文件既有的具名导入对账同一思路。
 */
describe('C 端错误文案不回显原始错误', () => {
  const readSource = async (relativePath: string) => {
    const { readFile } = await import('node:fs/promises');
    return readFile(resolve(PROJECT_ROOT, relativePath), 'utf8');
  };

  it.each(['src/pages/checkout/hooks.ts', 'src/pages/checkout/page.tsx'])(
    '%s 不把 providersError 拼进用户可见文案',
    async (source) => {
      const code = await readSource(source);
      expect(code).not.toMatch(/`[^`]*\$\{\s*providersError\s*\}[^`]*`/);
    },
  );

  it('渠道读取失败与「没有可用渠道」仍分开，且原始报错进日志', async () => {
    const code = await readSource('src/pages/checkout/hooks.ts');
    expect(code).toMatch(/暂时无法获取支付方式/);
    expect(code).toMatch(/暂无可用支付方式，请联系管理员/);
    expect(code).toMatch(/console\.warn\('\[checkout\] 支付渠道加载失败', e\)/);
  });
});
