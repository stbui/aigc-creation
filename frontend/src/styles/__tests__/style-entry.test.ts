import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = join(HERE, '..', '..');
const STYLES_DIR = join(SRC_DIR, 'styles');
const TOKENS_FILE = join(STYLES_DIR, 'tokens.css');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, out);
    } else if (/\.(css|ts|tsx)$/.test(entry.name)) {
      out.push(fullPath);
    }
  }
  return out;
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

describe('style entry', () => {
  it('keeps global.css as a layered import-only entry', () => {
    const source = stripComments(readFileSync(join(STYLES_DIR, 'global.css'), 'utf8'));
    const lines = source
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

    expect(lines.every((line) => line.startsWith('@layer ') || line.startsWith('@import '))).toBe(
      true,
    );
  });

  it('does not ship the unused shadcn dark-theme scaffold', () => {
    expect(existsSync(join(STYLES_DIR, 'theme.css'))).toBe(false);
  });

  it('declares only tokens that are consumed by runtime styles or markup', () => {
    const tokenSource = readFileSync(TOKENS_FILE, 'utf8');
    const tokens = [
      ...new Set([...tokenSource.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gm)].map((match) => match[1])),
    ];
    const consumers = walk(SRC_DIR)
      .filter((file) => file !== TOKENS_FILE)
      .map((file) => readFileSync(file, 'utf8'))
      .join('\n');

    const unused = tokens.filter((token) => {
      const escaped = escapeRegExp(token);
      return [
        new RegExp(`var\\(\\s*${escaped}(?![\\w-])`),
        new RegExp(`\\(\\s*${escaped}\\s*\\)`),
      ].every((pattern) => !pattern.test(consumers));
    });

    expect(unused).toEqual([]);
  });

  it('targets shadcn slots instead of legacy ui-* aliases in shared baselines', () => {
    const sharedFiles = [
      join(STYLES_DIR, 'ui.css'),
      join(STYLES_DIR, 'auth.css'),
      join(SRC_DIR, 'layout', 'AppHeader.css'),
      join(SRC_DIR, 'layout', 'UserAccountMenu.css'),
    ];
    const source = stripComments(sharedFiles.map((file) => readFileSync(file, 'utf8')).join('\n'));

    expect(source).toContain("[data-slot='input']");
    expect(source).toContain("[data-slot='select-trigger']");
    expect(source).not.toMatch(/\.ui-(?:input|select-trigger|dropdown-item|dropdown-content)\b/);
  });
});
