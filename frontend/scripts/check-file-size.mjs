/**
 * 文件体积守卫 —— 防止拆分后的巨型文件回潮。
 *
 * 背景：历史三批瘦身（`AdminDashboardPage` / `ToolShell` / `works/page`）已完成。
 * 拆分本身不难，难的是不再长回去 —— 一个人往已经 700 行的页面里再塞 60 行，
 * 谁都不会觉得有问题。
 *
 * 规则：
 *   - 单文件 > 500 行：告警（提示该按 `docs/frontend-module-conventions.md` 分层）
 *   - 单文件 > 800 行：报错（未登记基线的文件直接失败）
 *
 * 棘轮：已存在且尚未拆分的大文件登记在 `BASELINE` 里，**只许变短**。
 *   - 超过基线任何一行即报错 —— 拆完之后又被塞回去的代码会被当场拦下
 *   - 低于基线会提示下调基线，避免基线烂在原地失去约束力
 *
 * 用法：node scripts/check-file-size.mjs [--verbose]
 * `--verbose` 打印全部告警文件，默认只列前 15 个。
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

const WARN_LINES = 500;
const ERROR_LINES = 800;
const SRC_DIR = 'src';
const VERBOSE = process.argv.includes('--verbose');

/**
 * 存量基线：文件路径 → 当前行数（`wc -l` 口径）。
 *
 * 每一项都是待拆的债务，不是许可证。拆分完成后请把该行删掉；如果只是缩短，
 * 脚本会提示你把数字改小。新增条目需要在这里留下理由 —— 否则守卫会退化成
 * 「谁都可以加一行豁免」。
 */
const BASELINE = {
  // 2026-11-10 存量债务棘轮化：全仓静态审计盘出 43 个 500+ 行文件。逐个拆到
  // 500 行以下要搬动约 5000 行、新增 40+ 文件，本轮按「零视觉差异 / 最小 diff」
  // 不做大范围重构；改为全部登记进棘轮。WARN_LINES / ERROR_LINES 与检查逻辑
  // 一字未改，约束反而从「可长到 800 行才报错」收紧为「任何一行增长立即失败」，
  // 500+ 行告警输出随之归零；文件缩短时脚本仍会提示下调基线，不会烂在原地。
  // 以下是待分批拆分的债务清单，不是许可证；新增文件仍走通用守卫。
  // 注：`lib/api.ts`、`types/api.d.ts`、`types/model.ts` 已按域拆分回落到 800 行内，
  // 但仍在 500+ 清单里，一并登记棘轮，防止再次长回去。
  // 2026-11-16 全表对账：17 条与代码漂移。>500 行的 12 条按下调数字（棘轮只许变短）；
  // ≤500 行的 5 条（`admin/assets/page`、`admin/model-calls/page`、`creative-image/page`、
  // `invitations/page`、`types/admin-ops`）按本文件规则「拆分完成后把该行删掉」清除，
  // 回落通用守卫（>500 告警、>800 报错）；另删 2 条失效引用 ——
  // `pages/CreditsPage.tsx`、`pages/ToolPage.tsx` 已在 54b6a58 改为 `pages/credits/`、
  // `pages/tool/` 目录，旧单文件不存在。
  'src/admin-ui/components/ui/sidebar.tsx': 726,
  'src/admin-ui/primitives/fields.tsx': 547,
  'src/admin-ui/primitives/form.tsx': 777,
  'src/admin-ui/primitives/table.tsx': 643,
  'src/lib/api.ts': 720,
  'src/pages/admin/channels/AllChannelModelsPanel.tsx': 508,
  'src/pages/admin/channels/ChannelModelManager.tsx': 625,
  'src/pages/admin/orders/OrderDetailDrawer.tsx': 511,
  'src/pages/admin/payments/PaymentsExceptionPanel.tsx': 518,
  'src/pages/admin/templates/page.tsx': 554,
  'src/pages/admin/tickets/page.tsx': 567,
  'src/pages/checkout/hooks.ts': 550,
  // 2026-11-16 积分账本三类型（CreditBusinessType / CreditLedgerEntry / CreditLedgerPage）
  // 拆到 `types/admin-credits.ts`，本文件回落到 611 行，基线随之下调。
  'src/types/admin-console.ts': 611,
  'src/types/admin-support.ts': 567,
  'src/types/api.d.ts': 615,
  'src/types/model.ts': 577,
};

function countLines(path) {
  const text = readFileSync(path, 'utf8');
  if (text === '') return 0;
  const newlines = (text.match(/\n/g) ?? []).length;
  return text.endsWith('\n') ? newlines : newlines + 1;
}

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return walk(path);
    return entry.isFile() && /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

const errors = [];
const warnings = [];
const stale = [];

for (const path of walk(SRC_DIR)) {
  const rel = relative(process.cwd(), path);
  const lines = countLines(path);
  const base = BASELINE[rel];

  if (base !== undefined) {
    if (lines > base) {
      errors.push(
        `${rel}: ${lines} 行，超过基线 ${base} 行（多出 ${lines - base} 行）。先拆分，或把这段逻辑放到新的子组件里`,
      );
    } else if (lines < base) {
      stale.push(
        `${rel}: 已降到 ${lines} 行，请把 BASELINE 里的 ${base} 改成 ${lines}${lines <= ERROR_LINES ? '（已达上限内，可直接删除该条目）' : ''}`,
      );
    }
    continue;
  }

  if (lines > ERROR_LINES) {
    errors.push(
      `${rel}: ${lines} 行，超过 ${ERROR_LINES} 行上限。按 docs/frontend-module-conventions.md 拆成 page + 业务组件`,
    );
  } else if (lines > WARN_LINES) {
    warnings.push(`${rel}: ${lines} 行`);
  }
}

for (const line of stale) {
  console.warn(`[体积守卫] 基线待下调  ${line}`);
}

if (warnings.length > 0) {
  const shown = VERBOSE ? warnings : warnings.slice(0, 15);
  for (const line of shown) {
    console.warn(`[体积守卫] 建议拆分  ${line}`);
  }
  if (warnings.length > shown.length) {
    console.warn(`[体积守卫] 另有 ${warnings.length - shown.length} 个 500+ 行文件未列出（加 --verbose 查看全部）`);
  }
}

if (errors.length > 0) {
  for (const line of errors) {
    console.error(`[体积守卫] 违规  ${line}`);
  }
  console.error(`\n文件体积守卫未通过：${errors.length} 个文件超限。`);
  process.exit(1);
}

console.log(`文件体积守卫通过：${warnings.length} 个文件 500+ 行（告警），无 800+ 行新增违规。`);
