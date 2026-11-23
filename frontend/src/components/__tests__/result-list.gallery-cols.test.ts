import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * 结果画廊列数（T-023 回归）。
 *
 * 组件恒定渲染 `.fc-result-gallery fc-cols-${cols}`，所以窄屏「一刀切 2 列」
 * 的规则必须赢过 `.fc-result-gallery.fc-cols-N`（0,2,0）：
 *   - 选择器特异性不够（只写单类，0,1,0）→ 永远被压过，与源码顺序无关；
 *   - 特异性相同（0,2,0）时由源码顺序决定，媒体块必须排在上面那些规则之后。
 *
 * 真实页面实测（1440/1201/1200/1199/901/900/899/641/640/639/481/480/479，
 * 用户选 6 列）：改前 ≤640 仍是 6 列，改后 640 整点起为 2 列、641 起仍 6 列。
 * jsdom 不跑媒体查询层叠，这里用源码断言守同一条不变量。
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const CSS = readFileSync(join(HERE, '..', 'result-list.css'), 'utf8');

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** 类选择器特异性（本文件只有类选择器；`.a.b` 记 2）。 */
function classCount(selector: string): number {
  return (selector.match(/\./g) ?? []).length;
}

interface MediaBlock {
  params: string;
  body: string;
  start: number;
}

function findMediaBlocks(source: string): MediaBlock[] {
  const blocks: MediaBlock[] = [];
  const re = /@media\s*([^{]+)\{/g;
  for (let match = re.exec(source); match; match = re.exec(source)) {
    let depth = 1;
    let cursor = re.lastIndex;
    while (cursor < source.length && depth > 0) {
      if (source[cursor] === '{') depth += 1;
      else if (source[cursor] === '}') depth -= 1;
      cursor += 1;
    }
    blocks.push({
      params: match[1].trim(),
      body: source.slice(re.lastIndex, cursor - 1),
      start: match.index,
    });
    re.lastIndex = cursor;
  }
  return blocks;
}

const RULE = /([^{}]+)\{([^{}]*)\}/g;

describe('result-list 画廊窄屏列数', () => {
  const css = stripComments(CSS);
  const narrow = findMediaBlocks(css).filter((block) => block.params === '(max-width: 640px)');

  it('窄屏 2 列只声明一次，且用闭区间（640 整点生效）', () => {
    const withCols = narrow.filter((block) => /--fc-cols\s*:/.test(block.body));
    expect(withCols).toHaveLength(1);
    // 手写 CSS 的 max-width 是闭区间；Tailwind 的 width < 640px 会在 640 整点失效
    expect(withCols[0].params).toBe('(max-width: 640px)');
    expect(css).not.toContain('width < 640px');
  });

  it('窄屏覆盖规则的权重足以压过 .fc-cols-N，且排在它之后', () => {
    const block = narrow.find((item) => /--fc-cols\s*:/.test(item.body));
    const rules = [...(block?.body ?? '').matchAll(RULE)].filter((rule) =>
      /--fc-cols\s*:/.test(rule[2]),
    );
    expect(rules).toHaveLength(1);

    const selector = rules[0][1].replace(/\s+/g, ' ').trim();
    expect(selector).toContain('.fc-result-gallery');
    expect(classCount(selector)).toBeGreaterThanOrEqual(2);
    expect(rules[0][2]).not.toContain('!important');

    const value = rules[0][2].match(/--fc-cols\s*:\s*(\d+)/);
    expect(value?.[1]).toBe('2');

    // 同特异性时靠源码顺序；媒体块必须在 .fc-cols-N 之后
    const lastColsRule = [...css.matchAll(/\.fc-result-gallery\.fc-cols-\d+\s*\{/g)].pop();
    expect(lastColsRule).toBeDefined();
    expect(block?.start).toBeGreaterThan(lastColsRule?.index ?? 0);
  });
});
