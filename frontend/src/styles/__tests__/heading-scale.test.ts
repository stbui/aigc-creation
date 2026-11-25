import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * 页头字号分级（T-038，docs/design/standards/responsive-layout.md §3.1）。
 *
 * L2 页面标题：桌面 28 / ≤640 24。
 * L3 工作台标题：桌面 18 / ≤640 16。
 *
 * 两处失败点各自落在不同文件：
 *   - `/works` 的 L2 页头在 `pages/works/style.css`，≤900 档把字号固定成 28，
 *     缺 ≤640 档，390 下仍是 28。
 *   - `/free-creation` 的 L3 标题在 TSX 里带 Tailwind `text-base`（16/22），
 *     样式层用 `.pk-input-pane h1` 覆盖为 18/26，≤640 再降到 16/24。
 *
 * sr-only 语义标题不参与视觉排版，本任务按共识**不加字号**：断言样式层里
 * 没有 `h1.sr-only` 的字号规则，防止「形式满足」回流。
 *
 * 真实浏览器实测（1366/900/899/390 四档）见 Transfers/T038-shots/。
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '..', '..');
const TOOL_WORKSPACE = readFileSync(join(SRC, 'styles', 'tool-workspace.css'), 'utf8');
const WORKS = readFileSync(join(SRC, 'pages', 'works', 'style.css'), 'utf8');

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

function fontSizeIn(body: string, selector: string): number | null {
  const rule = new RegExp(`${selector.replace('.', '\\.')}\\s*\\{([^}]*)\\}`).exec(body);
  const size = rule?.[1].match(/font-size\s*:\s*(\d+)px/);
  return size ? Number.parseInt(size[1], 10) : null;
}

describe('页头字号分级 · L3 工具页（/free-creation）', () => {
  const css = stripComments(TOOL_WORKSPACE);
  const blocks = findMediaBlocks(css);
  const narrow = blocks.find(
    (block) => block.params === '(max-width: 640px)' && /\.pk-input-pane h1/.test(block.body),
  );

  it('基础档为 18px，≤640 为 16px，且窄屏覆盖在后', () => {
    expect(fontSizeIn(css, '.pk-input-pane h1')).toBe(18);
    expect(narrow).toBeDefined();
    expect(fontSizeIn(narrow?.body ?? '', '.pk-input-pane h1')).toBe(16);
    expect(narrow?.start).toBeGreaterThan(css.search(/^\.pk-input-pane h1\s*\{/m));
  });

  it('不给 sr-only 语义标题加字号（不参与视觉排版）', () => {
    expect(css).not.toMatch(/h1\.sr-only/);
  });
});

describe('页头字号分级 · L2 作品页（/works）', () => {
  const css = stripComments(WORKS);
  const blocks = findMediaBlocks(css);
  const mid = blocks.find(
    (block) => block.params === '(max-width: 900px)' && /\.my-works-heading h1/.test(block.body),
  );
  const narrow = blocks.find(
    (block) => block.params === '(max-width: 640px)' && /\.my-works-heading h1/.test(block.body),
  );

  it('桌面 28、≤640 24，且 640 档排在此前各档之后', () => {
    expect(fontSizeIn(css, '.my-works-heading h1')).toBe(28);
    expect(narrow).toBeDefined();
    expect(fontSizeIn(narrow?.body ?? '', '.my-works-heading h1')).toBe(24);
    expect(mid).toBeDefined();
    expect(narrow?.start).toBeGreaterThan(mid?.start ?? 0);
  });
});
