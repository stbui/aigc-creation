import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * 结果操作区（每行张数 + 刷新）窄屏排布（T-046 回归）。
 *
 * ≤640 时外壳工具栏已竖排（`tool-workspace.css` 的 `.pk-result-toolbar`），
 * 操作区独占一行：列数选择靠左、刷新靠右。这要求覆盖规则赢过基础规则
 * `justify-content: flex-end`。
 *
 * 本文件的选择器与基础规则同为单类（0,1,0），所以只能靠源码顺序取胜：
 * 覆盖必须写在基础规则之后。T-046 之前它写在文件顶部，宽度 100% 生效、
 * 对齐却被压回 flex-end —— 实测 640 视口左侧空出 335px。
 *
 * 真实页面实测见 Transfers/T046-shots/（measure.json + 9 档截图）。
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const CSS = readFileSync(join(HERE, '..', 'result-list.css'), 'utf8');

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '');
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

describe('result-list 操作区窄屏排布', () => {
  const css = stripComments(CSS);
  const narrow = findMediaBlocks(css).filter((block) => /\.fc-result-actions\b/.test(block.body));

  it('窄屏覆盖写在基础规则之后，靠源码顺序取胜', () => {
    expect(narrow).toHaveLength(1);
    expect(narrow[0].params).toBe('(max-width: 640px)');

    // 基础规则（单类）必须在覆盖之前；覆盖之后不得再有同特异性规则
    const baseIndex = css.search(/^\.fc-result-actions\s*\{/m);
    expect(baseIndex).toBeGreaterThanOrEqual(0);
    expect(narrow[0].start).toBeGreaterThan(baseIndex);
    expect(css.lastIndexOf('.fc-result-actions')).toBeGreaterThan(narrow[0].start);
  });

  it('覆盖声明 width 与 space-between，且不用 !important', () => {
    const block = narrow[0].body;
    expect(block).not.toContain('!important');
    expect(block).toMatch(/justify-content\s*:\s*space-between/);
    expect(block).toMatch(/width\s*:\s*100%/);
  });

  it('基础规则默认右对齐（覆盖压掉的就是这一条）', () => {
    const base = /\.fc-result-actions\s*\{([^}]*)\}/.exec(css);
    expect(base?.[1]).toMatch(/justify-content\s*:\s*flex-end/);
  });
});
