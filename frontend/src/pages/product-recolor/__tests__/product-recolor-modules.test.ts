import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { auditNamedImports, PROJECT_ROOT } from '../../../test/namedImportAudit';
import { colorLabelOf, recolorPayload } from '../utils';

/**
 * 商品换色页面的具名导入 / 导出对账。
 *
 * 与其余 C 端功能目录同因：多文件功能目录按分层约定拆成「入口文件 + 业务组件」后，
 * 一个名字写错就是整页白屏，而 Vite 把具名导入改写成属性访问，缺失的名字只会是
 * `undefined` —— 单文件转译与 Vitest 都不会报错。这里直接读源码对账。
 *
 * 判据实现与后台 / 其余 C 端目录共用 `src/test/namedImportAudit.ts`。
 */

const ROOTS = [
  'src/pages/product-recolor',
  'src/components',
  'src/hooks',
  'src/lib',
  'src/context',
];

describe('商品换色页具名导入', () => {
  it('每条相对导入的名字都能在目标模块里找到', () => {
    const roots = ROOTS.map((root) => resolve(PROJECT_ROOT, root));
    const failures = auditNamedImports(roots);

    expect(failures).toEqual([]);
  });
});

describe('商品换色页结果与提交参数', () => {
  it('预设色显示中文名，自定义色显示输入框里的 HEX 原值', () => {
    expect(colorLabelOf('#3988E9', '#5546D8')).toBe('蓝色');
    // COLOR_LABEL 里也登记了 custom →「自定义」，这里必须回落到 HEX。
    expect(colorLabelOf('custom', '#7b2ff7')).toBe('#7b2ff7');
  });

  it('提交参数以 targetColor 为准，比例与画质原样透传', () => {
    const settings = { ratio: '9:16', resolution: '4k' };

    expect(recolorPayload('#3988E9', '#5546D8', settings)).toEqual({
      targetColor: '#3988E9',
      customColor: '#5546D8',
      ratio: '9:16',
      size: '4k',
    });
    expect(recolorPayload('custom', '#7B2FF7', settings)).toEqual({
      targetColor: '#7B2FF7',
      customColor: '#7B2FF7',
      ratio: '9:16',
      size: '4k',
    });
  });
});
