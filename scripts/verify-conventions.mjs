#!/usr/bin/env node
/**
 * 仓库级约定检查。
 *
 * 这些规则来自 CLAUDE.md 与 docs/ 的硬约束，Biome 无法覆盖：
 *   1. 最小字号 12px；
 *   2. C 端 StateError 不得把原始错误透给用户；
 *   3. 根 / backend / frontend / agent 版本号一致。
 *
 * 只做静态扫描，不需要起服务。退出码非零表示有违规。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const violations = [];

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
      walk(full, out);
    } else {
      out.push(full);
    }
  }
  return out;
}

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}

function report(file, line, message) {
  violations.push(`${relative(ROOT, file)}:${line}  ${message}`);
}

// ── 1. 最小字号 12px ────────────────────────────────────────────────
const SIZE_PATTERNS = [
  /text-\[(?:0?\d|1[01])(?:\.\d+)?px\]/g,
  /font-size\s*:\s*(?:0?\d|1[01])(?:\.\d+)?px/gi,
  /fontSize\s*:\s*(?:0?\d|1[01])(?:\.\d+)?\b/g,
];

for (const file of walk(join(ROOT, 'frontend/src'))) {
  if (!/\.(ts|tsx|css)$/.test(file)) continue;
  if (/\.(test|spec)\.(ts|tsx)$/.test(file)) continue;
  const text = readFileSync(file, 'utf8');
  for (const pattern of SIZE_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      report(file, lineOf(text, match.index), `字号小于 12px：${match[0]}`);
    }
  }
}

// ── 2. C 端 StateError 不得传 detail ────────────────────────────────
const ADMIN_TREES = ['frontend/src/pages/admin', 'frontend/src/admin-ui', 'frontend/src/components/admin'];

for (const file of walk(join(ROOT, 'frontend/src'))) {
  if (!/\.tsx$/.test(file)) continue;
  if (/\.(test|spec)\.tsx$/.test(file)) continue;
  const rel = relative(ROOT, file);
  if (ADMIN_TREES.some((prefix) => rel.startsWith(prefix))) continue;

  const text = readFileSync(file, 'utf8');
  const tag = /<StateError\b[\s\S]*?>/g;
  for (const match of text.matchAll(tag)) {
    if (/\bdetail\s*=/.test(match[0])) {
      report(file, lineOf(text, match.index), 'C 端 StateError 不应传 detail（原始错误只进日志）');
    }
  }
}

// ── 3. 版本号一致 ───────────────────────────────────────────────────
const PACKAGES = ['', 'backend', 'frontend', 'agent'];
const versions = [];
for (const dir of PACKAGES) {
  const file = join(ROOT, dir, 'package.json');
  if (!existsSync(file)) continue;
  const pkg = JSON.parse(readFileSync(file, 'utf8'));
  versions.push({ label: dir || 'root', version: String(pkg.version ?? '') });
}
const unique = [...new Set(versions.map((item) => item.version))];
if (unique.length > 1) {
  const detail = versions.map((item) => `${item.label}=${item.version || '(未声明)'}`).join(' / ');
  violations.push(`package.json 版本不一致：${detail}`);
}

if (violations.length > 0) {
  console.error(`约定检查失败（${violations.length} 项）：`);
  for (const item of violations) console.error(`  - ${item}`);
  process.exit(1);
}

console.log('约定检查通过：字号 >= 12px、C 端无 StateError detail、版本号一致。');
