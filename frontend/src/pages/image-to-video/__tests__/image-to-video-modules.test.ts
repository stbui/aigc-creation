import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { auditNamedImports, PROJECT_ROOT } from '../../../test/namedImportAudit';

/**
 * 图生视频页面的具名导入 / 导出对账。
 *
 * 页面由多个业务组件组合而成。Vite 会把具名导入改写成属性访问，单个缺失
 * 导出名在转译和 Vitest 中可能只表现为 `undefined`，最终导致整页白屏，
 * 因此这里直接读取源码核对相对导入。
 */

const ROOTS = [
  'src/pages/image-to-video',
  'src/components',
  'src/hooks',
  'src/lib',
  'src/context',
];

describe('图生视频页面具名导入', () => {
  it('每条相对导入的名字都能在目标模块里找到', () => {
    const failures = auditNamedImports(ROOTS.map((root) => resolve(PROJECT_ROOT, root)));

    expect(failures).toEqual([]);
  });
});
