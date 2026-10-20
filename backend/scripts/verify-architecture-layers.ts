/**
 * 三层架构边界断言 (2026-10-20 厂商聚合组件)。
 *
 * ## 这个脚本要证明什么
 *
 * 架构图承诺的是:
 * ```
 *   应用层 (aa / bb / cc 应用)
 *        ↓  只依赖统一模型能力层
 *   统一模型能力层 (文/图/视)
 *        ↓
 *   厂商层 (a 厂 / b 厂 / c 厂)
 *        ↓
 *   协议层 (统一各个协议)
 * ```
 *
 * 分层最容易腐化的地方不是「层写错了」, 而是**依赖方向反了**:
 *   - 统一能力层反过来 import 厂商层 → 应用层想换厂商就得改能力层
 *   - 协议层 import 厂商层 → 协议形状与厂商身份又揉在一起 (回到改造前)
 *   - 厂商层自己声明 sizeStyle → 与协议层重复, 两处漂移的根源回来了
 *
 * 这三类退化**类型系统完全看不出来** (都是合法的 import),
 * 且症状都是"以后改起来越来越难" —— 不会立刻报错, 所以必须用断言钉住。
 */

import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

let pass = 0;
const fails: string[] = [];
const ok = (n: string, c: boolean, d?: unknown) => {
  if (c) pass += 1;
  else fails.push(`${n}${d !== undefined ? ` — ${JSON.stringify(d)}` : ''}`);
};

const SRC = join(__dirname, '..', 'src', 'providers');

/** 读文件并抽出它的 import 目标 (仅相对路径) */
function importsOf(relPath: string): string[] {
  const src = readFileSync(join(SRC, relPath), 'utf-8');
  const out: string[] = [];
  const re = /^import[\s\S]*?from\s+'([^']+)'/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    if (m[1].startsWith('.')) out.push(m[1]);
  }
  return out;
}

// ── 1. 目录结构: 三层各自的落点 ─────────────────────────────────────
{
  const dirs = readdirSync(SRC, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  ok('存在 unified/ (统一模型能力层)', dirs.includes('unified'), dirs);
  ok('存在 vendors/ (厂商层)', dirs.includes('vendors'), dirs);
  ok('存在 protocols/ (协议层)', dirs.includes('protocols'), dirs);
}

// ── 2. 统一能力层: 不得依赖厂商层或协议层 ─────────────────────────
// 理由: 应用层只注入「统一模型能力层」的接口, 故该层必须是**叶子**。
// 若它 import 厂商层, 换一个厂商就要动能力层 —— 分层名存实亡。
//
// ⚠️ 例外: `../modality` 是**共享叶子模块** (模态类型被三层共用),
// 依赖它不构成层间耦合 —— 故断言只禁 vendor / protocols 目录。
{
  const unifiedFiles = readdirSync(join(SRC, 'unified')).filter((f) => f.endsWith('.ts'));
  ok('unified/ 至少有一个文件', unifiedFiles.length > 0, unifiedFiles);
  for (const f of unifiedFiles) {
    const deps = importsOf(join('unified', f));
    const bad = deps.filter((d) => d.includes('vendor') || d.includes('protocols'));
    ok(`unified/${f} 不依赖厂商层/协议层`, bad.length === 0, bad);
  }
}

// ── 3. 协议层: 不得依赖厂商层 ───────────────────────────────────────
// 理由: 协议是「形状」, 厂商是「身份」。协议层一旦知道厂商是谁,
// 同一份协议就要按厂商再抄一遍 —— 正是改造前 9 条预设抄协议描述的根源。
{
  const protoFiles = readdirSync(join(SRC, 'protocols')).filter((f) => f.endsWith('.ts'));
  ok('protocols/ 至少有一个文件', protoFiles.length > 0, protoFiles);
  for (const f of protoFiles) {
    const deps = importsOf(join('protocols', f));
    const bad = deps.filter((d) => d.includes('vendor'));
    ok(`protocols/${f} 不依赖厂商层`, bad.length === 0, bad);
  }
}

// ── 4. 厂商层: 必须依赖协议层 (引用协议而非重声明) ──────────────────
{
  const vendorFiles = readdirSync(join(SRC, 'vendors')).filter((f) => f.endsWith('.ts'));
  const catalog = importsOf(join('vendors', 'vendor.catalog.ts'));
  ok(
    'vendor.catalog 引用协议层',
    catalog.some((d) => d.includes('protocol')),
    catalog,
  );
  // 厂商目录**不得**自己声明 sizeStyle / maxRefImages / refStyle
  const src = readFileSync(join(SRC, 'vendors', 'vendor.catalog.ts'), 'utf-8');
  for (const field of ['sizeStyle', 'maxRefImages', 'refStyle']) {
    // 只允许出现在注释里, 不允许是字段声明
    const decl = new RegExp(`^\\s*${field}\\??:`, 'm');
    ok(`vendor.catalog 不声明 ${field} (属协议层)`, !decl.test(src));
  }
}

// ── 5. 转发层不得声明数据 ───────────────────────────────────────────
// provider-presets.ts 已改为转发层; 若它再声明一份预设, 就是两个真相源。
{
  const src = readFileSync(join(SRC, 'provider-presets.ts'), 'utf-8');
  const declares = /^export const (VENDOR_PRESETS|PROTOCOL_SPECS)\s*[:=]/m.test(src);
  ok('provider-presets 是转发层, 不声明数据', !declares);
  ok('provider-presets 转发厂商层', /from '\.\/vendors\/vendor\.presets'/.test(src));
  ok('provider-presets 转发协议层', /from '\.\/protocols\/protocol\.spec'/.test(src));
}

// ── 6. 旧接口文件已转为转发, 不再各自定义类型 ───────────────────────
{
  for (const f of ['image-provider.interface.ts', 'text-provider.interface.ts']) {
    const src = readFileSync(join(SRC, f), 'utf-8');
    ok(`${f} 不再定义 interface`, !/^export interface /m.test(src));
    ok(`${f} 转发统一能力层`, src.includes("from './unified/unified.provider'"));
  }
}

// ── 7. 无循环依赖 (三层之间) ────────────────────────────────────────
// 判据: 厂商层 → 协议层 → (不指回厂商层); 统一层不指任何层。
{
  const protoDeps = new Set<string>();
  for (const f of readdirSync(join(SRC, 'protocols')).filter((x) => x.endsWith('.ts'))) {
    for (const d of importsOf(join('protocols', f))) protoDeps.add(d);
  }
  ok('协议层不指回厂商层', ![...protoDeps].some((d) => d.includes('vendor')), [...protoDeps]);

  const unifiedDeps = new Set<string>();
  for (const f of readdirSync(join(SRC, 'unified')).filter((x) => x.endsWith('.ts'))) {
    for (const d of importsOf(join('unified', f))) unifiedDeps.add(d);
  }
  // 唯一允许的依赖是共享叶子模块 ../modality
  const badUnified = [...unifiedDeps].filter((d) => d !== '../modality');
  ok('统一能力层只依赖共享叶子模块', badUnified.length === 0, [...unifiedDeps]);
}

// ── 8. 关键实现已收敛: 协议形状只有一份 ─────────────────────────────
// provider 实现不应再自带 sizeStyle / maxRefImages / refStyle
{
  for (const f of [
    'modelverse-image.provider.ts',
    'volcengine-image.provider.ts',
    'minimax-image.provider.ts',
  ]) {
    const src = readFileSync(join(SRC, f), 'utf-8');
    for (const field of ['sizeStyle', 'maxRefImages', 'refStyle']) {
      const decl = new RegExp(`^\\s*${field}\\s*:`, 'm');
      ok(`${f} 不声明 ${field}`, !decl.test(src));
    }
    ok(`${f} 已继承统一基座`, /extends BaseImageProvider/.test(src));
  }
}

// ── 9. modelverse 已瘦身 (不再自带骨架) ────────────────────────────
{
  const src = readFileSync(join(SRC, 'modelverse-image.provider.ts'), 'utf-8');
  const lines = src.split('\n').length;
  ok('modelverse 已瘦身到 100 行以内 (原 238)', lines < 100, lines);
  ok('modelverse 不再自带 request/download', !/private async (request|download)\b/.test(src));
}

// ── 汇总 ────────────────────────────────────────────────────────────
console.log(`\n通过 ${pass} 项`);
if (fails.length) {
  console.error(`\n失败 ${fails.length} 项:`);
  for (const f of fails) console.error('  ✗ ' + f);
  process.exit(1);
}
console.log('三层架构边界断言全部通过（依赖方向单向、协议形状单一来源、转发层不声明数据）');