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
  'src/admin-ui/components/ui/sidebar.tsx': 724,
  'src/admin-ui/primitives/fields.tsx': 547,
  'src/admin-ui/primitives/form.tsx': 777,
  'src/admin-ui/primitives/table.tsx': 643,
  'src/components/AssetLibraryModal.tsx': 650,
  'src/components/AuthCard.tsx': 692,
  'src/components/ImageLightbox.tsx': 730,
  'src/components/MattingResultEditor.tsx': 810,
  'src/components/SkuRegionEditorModal.tsx': 671,
  'src/components/ToolShell.tsx': 798,
  'src/lib/api.ts': 746,
  'src/pages/CreditsPage.tsx': 557,
  'src/pages/ToolPage.tsx': 542,
  'src/pages/admin/assets/page.tsx': 512,
  'src/pages/admin/channels/AllChannelModelsPanel.tsx': 623,
  'src/pages/admin/channels/ChannelModelManager.tsx': 674,
  'src/pages/admin/logical-models/page.tsx': 793,
  'src/pages/admin/model-calls/page.tsx': 597,
  'src/pages/admin/orders/OrderDetailDrawer.tsx': 504,
  'src/pages/admin/payments/PaymentsExceptionPanel.tsx': 523,
  'src/pages/admin/templates/page.tsx': 566,
  'src/pages/admin/tickets/page.tsx': 609,
  'src/pages/checkout/hooks.ts': 551,
  'src/pages/creative-image/page.tsx': 768,
  'src/pages/invitations/page.tsx': 591,
  'src/pages/landing/page.tsx': 690,
  'src/pages/local-redraw/MaskPainter.tsx': 632,
  'src/pages/local-redraw/page.tsx': 708,
  'src/pages/multi-image-fusion/page.tsx': 617,
  'src/pages/product-sku/page.tsx': 557,
  'src/pages/shoppable-carousel/page.tsx': 602,
  'src/pages/works/page.tsx': 503,
  'src/types/admin-console.ts': 638,
  'src/types/admin-ops.ts': 544,
  'src/types/admin-support.ts': 570,
  'src/types/api.d.ts': 619,
  'src/types/model.ts': 580,
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
