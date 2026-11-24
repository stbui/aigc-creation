import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * 后台断点口径守卫（T-040，docs/admin-ui-design.md §5.3）。
 *
 * 后台最低支持宽度 = **1280px**（依据外壳 `AdminBoardLayout` 的
 * `matchMedia('(max-width: 1280px)')` 侧栏折叠）。由此得出两条不变量：
 *
 * 1. 不得出现 `max-*` 变体。`max-sm/md/lg/xl` 的上界都在 1280 以下，
 *    在支持区间内恒不生效 —— 那是纯死代码，也是「后台还能窄屏」的错误暗示。
 * 2. min-width 变体的阈值必须 ≤1280（`sm`640 / `md`768 / `lg`1024 / `xl`1280）。
 *    这类变体在支持区间内恒生效，等价于基类；阈值超过 1280 的 `2xl`
 *    会让后台在 1280–1536 之间出现真正的降档，属于支持区间内的响应式，
 *    必须单独评审后再放行。
 *
 * 现状（2026-11-24 审计）：`admin-ui/**` 内 `max-*` 为 0；56 处真实变体
 * 全部是 sm/md/lg/xl，另有 11 处是 cva `size` 的键名（`sm:` / `lg:`）与
 * 宽度常量表的键名，不是断点，故排除。逐文件对照表见
 * `~/OpenBot/Shared/Transfers/20261124-zhangfei-T040-admin-ui-floor.md`。
 *
 * 只扫自研文件不做豁免：`components/ui/**` 是 shadcn 上游件，本次未改，
 * 若后续 `shadcn add` 带入 `max-*` 或 `2xl:`，本用例即红，提醒跑
 * `post-shadcn.mjs` 或在评审里补依据。
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const ADMIN_UI = join(HERE, '..');
const SRC = join(ADMIN_UI, '..');

/** min-width 变体在 Tailwind 4.3.3 默认刻度下的阈值（px）。 */
const MIN_WIDTH_PX: Record<string, number> = {
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
  '2xl': 1536,
};

const FLOOR = 1280;

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return walk(path);
    return /\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.test.ts') &&
      !entry.name.endsWith('.test.tsx')
      ? [path]
      : [];
  });
}

/**
 * 剥掉注释再扫：说明文字里会引用 `md:` / `max-xl:` 这类写法（本次收口自己
 * 就写了），不剥会把文档性文字判成真实变体。
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ''))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1: string) => p1);
}

/**
 * 区分「真实响应式变体」与「对象键名」。
 *
 * `size: { sm: "h-8 ..." }`、`{ xl: 1080 }` 这类键名会被朴素正则误判成断点：
 * 键名的特征是 `sm:` 前只有缩进/引号，后面紧跟空白与引号或数字。
 */
function realVariants(rawSource: string): Array<{ line: number; variant: string }> {
  const source = stripComments(rawSource);
  const out: Array<{ line: number; variant: string }> = [];
  const re = /(^|[^a-zA-Z0-9_-])(sm|md|lg|xl|2xl):/g;
  source.split('\n').forEach((text, index) => {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const before = text.slice(0, m.index + m[1].length);
      const after = text.slice(m.index + m[0].length);
      const isObjectKey = /^\s*["'`]?\s*$/.test(before) && /^\s+["'`]|\s+\d/.test(after);
      if (!isObjectKey) out.push({ line: index + 1, variant: m[2] });
    }
  });
  return out;
}

const FILES = walk(ADMIN_UI).map((path) => ({
  path: relative(SRC, path),
  source: readFileSync(path, 'utf8'),
}));

describe('后台原子件断点口径（最低支持宽度 1280）', () => {
  it('admin-ui 内没有任何 max-* 断点变体', () => {
    const hits = FILES.flatMap(({ path, source }) => {
      const found: string[] = [];
      stripComments(source).split('\n').forEach((text, index) => {
        // max-w-* / max-h-* 是尺寸工具类，不是断点；只认 max-{断点}: 与 max-[Npx]:
        const m = text.match(/(^|[^a-zA-Z0-9_-])max-(sm|md|lg|xl|2xl):|(^|[^a-zA-Z0-9_-])max-\[\d/);
        if (m) found.push(`${path}:${index + 1}`);
      });
      return found;
    });
    expect(hits).toEqual([]);
  });

  it('admin-ui 内真实 min-width 变体的阈值都 ≤1280', () => {
    const offenders = FILES.flatMap(({ path, source }) =>
      realVariants(source)
        .filter(({ variant }) => (MIN_WIDTH_PX[variant] ?? 0) > FLOOR)
        .map(({ line, variant }) => `${path}:${line} ${variant}: (${MIN_WIDTH_PX[variant]}px > ${FLOOR}px)`),
    );
    expect(offenders).toEqual([]);
  });

  it('admin-ui 内没有超过 1280 的 min-[] 任意断点', () => {
    const hits = FILES.filter(({ source }) =>
      /(^|[^a-zA-Z0-9_-])min-\[\d/.test(stripComments(source)),
    ).map(({ path }) => path);
    expect(hits).toEqual([]);
  });

  it('外壳侧栏折叠阈值固定为 1280（口径的事实源）', () => {
    const layout = FILES.find(({ path }) => path.endsWith('shell/AdminBoardLayout.tsx'));
    expect(layout).toBeDefined();
    expect(layout!.source).toMatch(/matchMedia\('\(max-width: 1280px\)'\)/);
  });

  it('已收口的两处自研件保持无断点（回退即红）', () => {
    const targets = [
      // 顶栏面包屑的「分组」项与分隔符：原 `hidden md:block`
      'shell/AdminBoardLayout.tsx',
      // 键值描述的多列：原 `sm:grid-cols-2|3`
      'radar/feedback.tsx',
    ];
    const offenders = targets.flatMap((suffix) => {
      const file = FILES.find(({ path }) => path.endsWith(suffix));
      expect(file, `${suffix} 未找到`).toBeDefined();
      return realVariants(file!.source).map(({ line, variant }) => `${suffix}:${line} ${variant}:`);
    });
    expect(offenders).toEqual([]);
  });
});