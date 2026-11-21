#!/usr/bin/env node
/**
 * 仓库级约定检查。
 *
 * 这些规则来自 CLAUDE.md 与 docs/ 的硬约束，Biome 无法覆盖：
 *   1. 最小字号 12px；
 *   2. C 端 StateError 不得把原始错误透给用户；
 *   3. 根 / backend / frontend / agent 版本号一致；
 *   4. CLAUDE.md §1「易腐化数量」表与代码实际数量一致；
 *   5. 后台页面只从 `admin-ui/radar` 取件，不直连原子件。
 *
 * 只做静态扫描，不需要起服务。退出码非零表示有违规。
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, posix, relative, resolve } from 'node:path';

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
const ADMIN_TREES = [
  'frontend/src/pages/admin',
  'frontend/src/admin-ui',
  'frontend/src/components/admin',
];

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

// ── 4. CLAUDE.md §1 易腐化数量与代码一致 ─────────────────────────────
/*
 * CLAUDE.md §1 有一张「易腐化数量」表，数字必须与代码同批更新。但它历史上
 * 真的漂过：`creative_image` 并入 `free_create` 后代码从 18 项降到 17 项，
 * 文档半年没跟，装配期校验只管单条定义是否完整，不会数数组长度。
 *
 * 这里**解析文档实际值再比对**，不写死任何数字 —— 否则文档改了、脚本还是
 * 旧的，等于又造一份真相。文档改了（无论改成多少），脚本自动跟着走。
 */

/** 从 CLAUDE.md 的表格行里抠出第一个「N 项能力」「N 个插件包」「N 个 provider」 */
function tableNumber(text, pattern, label) {
  const match = text.match(pattern);
  if (!match) {
    violations.push(`CLAUDE.md 中找不到「${label}」的数量表述（§1 易腐化数量表）`);
    return null;
  }
  return Number(match[1]);
}

const claudeText = existsSync(join(ROOT, 'CLAUDE.md'))
  ? readFileSync(join(ROOT, 'CLAUDE.md'), 'utf8')
  : '';

/*
 * 只在「易腐化数量」这张表里找数字，不收正文里的同一措辞。
 * 表格从该小标题开始，到表格结束后的第一个空行为止；找不到小标题就退回全文。
 */
const quantityTable = (() => {
  const start = claudeText.indexOf('易腐化数量');
  if (start < 0) return claudeText;
  const lines = claudeText.slice(start).split('\n');
  const out = [];
  let inTable = false;
  for (const line of lines) {
    const isTableRow = line.startsWith('|');
    if (isTableRow) {
      inTable = true;
      out.push(line);
    } else if (inTable) {
      break; // 表格已结束
    }
  }
  return out.length ? out.join('\n') : claudeText;
})();

if (!claudeText) {
  violations.push('CLAUDE.md 不存在，无法核对易腐化数量');
} else {
  // 4.1 能力：数量 + image/video 分布 + 进工作台数
  const indexFile = join(ROOT, 'backend/src/capabilities/definitions/index.ts');
  if (!existsSync(indexFile)) {
    violations.push('backend/src/capabilities/definitions/index.ts 不存在，无法核对能力数量');
  } else {
    const indexText = readFileSync(indexFile, 'utf8');
    const arrayBody = indexText.match(/CAPABILITY_PLUGINS[^=]*=\s*\[([\s\S]*?)\]/);
    if (!arrayBody) {
      violations.push('definitions/index.ts 中找不到 CAPABILITY_PLUGINS 数组字面量');
    } else {
      const entries = arrayBody[1]
        .split(',')
        .map((item) => item.trim())
        .filter((item) => item && !item.startsWith('//') && !item.startsWith('/*'));
      const capCount = entries.length;

      // 数组项是 PascalCase 导出名，逐个 file:line 找回 modality / inWorkbench
      const definitionsDir = join(ROOT, 'backend/src/capabilities/definitions');
      const modalityBySymbol = new Map();
      const workbenchSymbols = new Set();
      if (existsSync(definitionsDir)) {
        for (const name of readdirSync(definitionsDir)) {
          if (!name.endsWith('.ts')) continue;
          if (
            /\.spec\.ts$/.test(name) ||
            /-options\.ts$/.test(name) ||
            /\.templates\.ts$/.test(name)
          )
            continue;
          if (name === 'index.ts' || name === 'param-options.ts') continue;
          const fileText = readFileSync(join(definitionsDir, name), 'utf8');
          const decl = fileText.match(/export const (\w+)\s*:\s*CapabilityPlugin\s*=/);
          if (!decl) continue;
          const modality = fileText.match(/\n\s*modality:\s*'(\w+)'/);
          if (modality) modalityBySymbol.set(decl[1], modality[1]);
          if (/\n\s*inWorkbench:\s*true\b/.test(fileText)) workbenchSymbols.add(decl[1]);
        }
      }

      const missing = entries.filter((symbol) => !modalityBySymbol.has(symbol));
      if (missing.length) {
        violations.push(
          `CAPABILITY_PLUGINS 中这些项在 definitions/ 下找不到 modality 声明：${missing.join(', ')}`,
        );
      }

      const imageCount = entries.filter(
        (symbol) => modalityBySymbol.get(symbol) === 'image',
      ).length;
      const videoCount = entries.filter(
        (symbol) => modalityBySymbol.get(symbol) === 'video',
      ).length;
      const otherCount = capCount - imageCount - videoCount;
      const workbenchCount = entries.filter((symbol) => workbenchSymbols.has(symbol)).length;

      // 文档行形如：| 17 项能力 / 16 image + 1 video / 14 项进工作台 | ...
      const docCaps = tableNumber(quantityTable, /(\d+) 项能力/, '项能力');
      if (docCaps !== null && docCaps !== capCount) {
        violations.push(
          `CLAUDE.md 写「${docCaps} 项能力」，代码 CAPABILITY_PLUGINS 实为 ${capCount} 项` +
            `（definitions/index.ts:38）`,
        );
      }

      const docModality = quantityTable.match(/(\d+)\s*image\s*\+\s*(\d+)\s*video/i);
      if (!docModality) {
        violations.push('CLAUDE.md 中找不到「N image + N video」的模态分布表述（§1 易腐化数量表）');
      } else if (Number(docModality[1]) !== imageCount || Number(docModality[2]) !== videoCount) {
        violations.push(
          `CLAUDE.md 写「${docModality[1]} image + ${docModality[2]} video」，代码实为` +
            ` ${imageCount} image + ${videoCount} video` +
            (otherCount ? ` + ${otherCount} 其他模态` : ''),
        );
      }

      const docWorkbench = tableNumber(quantityTable, /(\d+) 项进工作台/, '项进工作台');
      if (docWorkbench !== null && docWorkbench !== workbenchCount) {
        violations.push(
          `CLAUDE.md 写「${docWorkbench} 项进工作台」，能力定义中 inWorkbench: true 实为 ${workbenchCount} 项`,
        );
      }
    }
  }

  // 4.2 插件包与 provider：`src-*` 镜像与 NOTICE 不计入
  const pluginsDir = join(ROOT, 'backend/plugins');
  if (!existsSync(pluginsDir)) {
    violations.push('backend/plugins 不存在，无法核对插件数量');
  } else {
    let packageCount = 0;
    let providerCount = 0;
    for (const entry of readdirSync(pluginsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue; // NOTICE 等文件不计
      if (entry.name.startsWith('src-')) continue; // 上游源目录镜像，运行期跳过
      const manifestPath = join(pluginsDir, entry.name, 'manifest.json');
      if (!existsSync(manifestPath)) continue;
      let manifest;
      try {
        manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      } catch (error) {
        violations.push(
          `插件清单不是合法 JSON：${relative(ROOT, manifestPath)}（${error.message}）`,
        );
        continue;
      }
      packageCount += 1;
      providerCount += (manifest.contributes?.providers ?? []).length;
    }

    const docPackages = tableNumber(quantityTable, /(\d+) 个插件包/, '个插件包');
    if (docPackages !== null && docPackages !== packageCount) {
      violations.push(
        `CLAUDE.md 写「${docPackages} 个插件包」，backend/plugins 实为 ${packageCount} 个` +
          `（已排除 src-* 镜像与 NOTICE）`,
      );
    }

    const docProviders = tableNumber(quantityTable, /(\d+) 个 provider/, '个 provider');
    if (docProviders !== null && docProviders !== providerCount) {
      violations.push(
        `CLAUDE.md 写「${docProviders} 个 provider」，manifest 声明实为 ${providerCount} 个`,
      );
    }
  }
}

// ── 5. 后台取件边界：页面不直连 admin-ui 原子件 ──────────────────────
/*
 * CLAUDE.md:106「后台页面只从 `admin-ui/radar` barrel 取件，不直连
 * `admin-ui/components/ui`；原子件仅供 radar 组合」。这条此前只靠人守，
 * 2026-11-21 的审计（T-002）发现 `admin-ui/primitives/` 删除后仍有漂移风险，
 * 故落成机器校验。
 *
 * ## 为什么要先归一化 specifier
 *
 * 同一个目标有三种写法，只匹配 `~/` 别名等于留了后门：
 *   - `~/admin-ui/components/ui/button`        → 别名
 *   - `../../../admin-ui/components/ui/button` → 相对路径
 *   - `admin-ui/components/ui/button`          → 裸写（与第三方包同形）
 * 前两种归一成「src 相对路径」后比较；裸写以 `admin-ui/` 开头的一律按本仓
 * 路径处理 —— 否则它会被当成第三方包放过（原型已验证）。当前代码里裸写
 * 零实例，但规则必须拦住，否则将来就是可绕的口子。
 *
 * ## 为什么要剥注释
 *
 * 注释里合法地提到这些路径：`pages/admin/alerts/page.tsx` 的迁移说明写着
 * 「原 `~/admin-ui/primitives`、现 `~/admin-ui/radar`」，另有 5 个页面模块的
 * 入口注释写着「本目录文件不从 `src/admin-ui/providers` 取」。不剥注释会
 * 当场误报。剥块注释与整行 `//`；行内 `//` 保守不剥（避免剥坏字符串里的
 * `//`，而 import 语句里不会出现）。
 */

const PAGE_ADMIN_TREES = ['frontend/src/pages/admin', 'frontend/src/components/admin'];

/* 白名单：这几类不是「原子件泄漏」的风险点，页面取它们是正当的。 */
const ALLOWED_ADMIN_IMPORT_PREFIXES = [
  'admin-ui/providers/',
  'admin-ui/hooks/',
  'admin-ui/shell/',
  'admin-ui/radar',
  'admin-ui/lib/',
];
/*
 * 债务而非设计：`providers/` 之所以放行，是因为它当前有 39 处直取、分布在
 * 33 个模块入口文件（`hooks.ts` / `components.ts`），收窄会当场红一片。
 * **收窄路径 = 等方案 B（radar barrel 转出 useToast / useConfirm）落地后，
 * 把上面 `admin-ui/providers/` 这一行删掉**，规则自然收紧，无需再改段号。
 */

const FORBIDDEN_ADMIN_IMPORT = [/^admin-ui\/components(\/|$)/, /^admin-ui\/primitives(\/|$)/];

/** 把 import specifier 归一成「以 frontend/src 为根的相对路径」，第三方包返回 null。 */
function resolveSpecifier(file, specifier) {
  if (specifier.startsWith('~/')) return specifier.slice(2);
  if (specifier.startsWith('admin-ui/')) return specifier;
  if (specifier.startsWith('.')) {
    const base = relative(join(ROOT, 'frontend/src'), join(file, '..'));
    return posix.normalize(posix.join(base.split('\\').join('/'), specifier));
  }
  return null;
}

/** 剥掉块注释与整行 `//`，让注释里的路径不参与匹配。 */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');
}

/**
 * 取出文件中所有 import / export-from / 动态 import 的 specifier，
 * 连同各自在原文中的偏移量一起返回，便于报出行号。
 */
function importTargets(source) {
  const found = [];
  const patterns = [
    // import ... from 'x' / export ... from 'x'（允许跨行）
    /(?:^|\n)[ \t]*(?:import|export)\s[^;'"]*?from\s*['"]([^'"]+)['"]/g,
    // import 'x'（side-effect）
    /(?:^|\n)[ \t]*import\s*['"]([^'"]+)['"]/g,
    // import('x')（动态）
    /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      found.push({ specifier: match[1], index: match.index });
    }
  }
  return found;
}

for (const tree of PAGE_ADMIN_TREES) {
  for (const file of walk(join(ROOT, tree))) {
    if (!/\.(ts|tsx)$/.test(file)) continue;
    if (/\.(test|spec)\.(ts|tsx)$/.test(file)) continue;

    const source = stripComments(readFileSync(file, 'utf8'));
    for (const { specifier, index } of importTargets(source)) {
      const target = resolveSpecifier(file, specifier);
      if (!target) continue;
      if (!FORBIDDEN_ADMIN_IMPORT.some((pattern) => pattern.test(target))) continue;
      if (ALLOWED_ADMIN_IMPORT_PREFIXES.some((prefix) => target.startsWith(prefix))) continue;

      report(
        file,
        lineOf(source, index),
        `后台页面直连原子件：${specifier} → ${target}；请改从 ~/admin-ui/radar 取件`,
      );
    }
  }
}

if (violations.length > 0) {
  console.error(`约定检查失败（${violations.length} 项）：`);
  for (const item of violations) console.error(`  - ${item}`);
  process.exit(1);
}

console.log(
  '约定检查通过：字号 >= 12px、C 端无 StateError detail、版本号一致、CLAUDE.md 易腐化数量与代码一致、后台取件边界合规。',
);
