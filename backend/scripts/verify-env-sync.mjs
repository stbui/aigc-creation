#!/usr/bin/env node
/**
 * 校验 `ENV_SPECS` ↔ 四份 env 文件 ↔ 例外清单 的一致性。
 *
 * 为什么需要这个脚本
 * ------------------
 * T-001 审计发现：ENV_SPECS 有 123 个变量，而 `.env.example` / 三档 env
 * 少了十几到几十个；`verify:conventions` 不覆盖这一项，于是漂移只能靠人工数。
 * 这里把「ENV_SPECS 的每个变量名必须能在每个 env 文件里找到，或属于
 * 请求期读取的例外清单」固化成一条命令。
 *
 * 口径
 * ----
 *   · 变量名从 `backend/src/config/env.validation.ts` 的 ENV_SPECS 抽取（`env: 'NAME'`）。
 *   · 例外清单与 env.validation.ts 顶部注释、`docs/environments.md` 保持一致。
 *   · 只校验「缺键位」；值是否正确、是否过期不在本脚本范围。
 *   · 反向（env 文件里有、ENV_SPECS 里没有）只告警，不失败 —— 可能是
 *     例外清单之外的脚本级变量（如 ADMIN_*），需人工判断。
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const backendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const SPEC_FILE = 'src/config/env.validation.ts';
const ENV_FILES = [
  '.env.example',
  '.env.production.example',
  '.env.development',
  '.env.test',
];

/** 请求期 / 业务层直接读 process.env 的变量：不要求出现在 ENV_SPECS，但仍要求有键位 */
const REQUEST_TIME_EXCEPTIONS = [
  'RATE_LIMIT_AUTH_PER_MIN',
  'RATE_LIMIT_RESET_TOKEN',
  'MODEL_PROXY_SYSTEM_RATE_LIMIT',
  'MODEL_PROXY_CUSTOM_RATE_LIMIT',
];

/** 脚本层变量：不属于应用启动契约，缺失不算错 */
const SCRIPT_ONLY = ['ADMIN_EMAIL', 'ADMIN_PASSWORD'];

const specText = readFileSync(resolve(backendRoot, SPEC_FILE), 'utf8');
const specNames = [
  ...new Set([...specText.matchAll(/env:\s*'([A-Z][A-Z0-9_]*)'/g)].map((m) => m[1])),
].sort();

if (specNames.length === 0) {
  console.error(`未从 ${SPEC_FILE} 解析到任何 ENV_SPECS 变量，检查正则或文件结构`);
  process.exit(2);
}

const REQUIRED = specNames.filter((n) => !REQUEST_TIME_EXCEPTIONS.includes(n));

function parseFile(rel) {
  const abs = resolve(backendRoot, rel);
  if (!existsSync(abs)) return null;
  const names = new Set();
  for (const line of readFileSync(abs, 'utf8').split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=/.exec(line);
    if (m) names.add(m[1]);
  }
  return names;
}

let failed = false;
const rows = [];

for (const rel of ENV_FILES) {
  const names = parseFile(rel);
  if (!names) {
    console.error(`缺失文件：${rel}`);
    failed = true;
    continue;
  }
  const missing = REQUIRED.filter((n) => !names.has(n));
  const extra = [...names].filter(
    (n) =>
      !specNames.includes(n) &&
      !REQUEST_TIME_EXCEPTIONS.includes(n) &&
      !SCRIPT_ONLY.includes(n),
  );
  rows.push({ rel, total: names.size, missing, extra });
  if (missing.length > 0) failed = true;
}

console.log(`ENV_SPECS: ${specNames.length} 个（例外 ${REQUEST_TIME_EXCEPTIONS.length} 个）`);
console.log(`四份 env 文件应含 ${REQUIRED.length} 个 ENV_SPECS 变量\n`);

for (const r of rows) {
  console.log(
    `${r.rel}: ${r.total} 个键位，缺 ${r.missing.length}，多 ${r.extra.length}`,
  );
  if (r.missing.length) console.log(`  缺: ${r.missing.join(', ')}`);
  if (r.extra.length) console.log(`  未登记（告警）: ${r.extra.join(', ')}`);
}

const extraWarnings = rows.some((r) => r.extra.length > 0);
console.log('');
if (failed) {
  console.error('env 同步检查失败：存在未补的变量名');
  process.exit(1);
}
console.log('env 同步检查通过' + (extraWarnings ? '（有未登记变量告警，见上）' : ''));