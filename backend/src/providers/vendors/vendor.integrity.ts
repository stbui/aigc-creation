import { PROTOCOL_SPECS, protocolSpec, videoProtocolSpec } from '../protocols/protocol.spec';
import { VENDOR_CATALOG, baseUrlOf, specOf } from './vendor.catalog';
import { VENDOR_PRESETS } from './vendor.presets';

/**
 * 装配期校验 —— 三层架构的一致性断言 (2026-10-20)。
 *
 * ## 为什么需要它
 *
 * 架构分层最大的风险不是"层写错了", 而是**层与层之间的引用断了**:
 *   - 厂商引用了一个协议层没有的协议 → 选了该厂商, 生成时报「未知协议」
 *   - 协议声明的模态与厂商通道的模态不符 → 文本请求被发到生图端点
 *   - 同一家厂商两个模态的通道 key 撞了 → 后台配置项互相覆盖
 *
 * 这三类问题在类型系统里**完全看不出来** (都是 string),
 * 且症状都是「运行时才发现、且是静默失败」——
 * 正是本项目反复要消灭的那类问题。
 *
 * 故在装配期一次性拦下。
 */

export interface CatalogIssue {
  scope: 'vendor' | 'protocol' | 'preset';
  key: string;
  message: string;
}

/**
 * 校验厂商目录与协议目录的一致性。
 *
 * @returns 问题清单; 空数组表示通过
 */
export function collectCatalogIssues(): CatalogIssue[] {
  const issues: CatalogIssue[] = [];

  // ── 协议层自身: 标识不得重复 ───────────────────────────────────
  const seenProto = new Set<string>();
  for (const p of PROTOCOL_SPECS) {
    if (seenProto.has(p.protocol)) {
      issues.push({ scope: 'protocol', key: p.protocol, message: '协议标识重复' });
    }
    seenProto.add(p.protocol);
  }

  // ── 厂商层: 每条通道的协议必须存在且模态匹配 ────────────────────
  const seenVendor = new Set<string>();
  for (const v of VENDOR_CATALOG) {
    if (seenVendor.has(v.key)) {
      issues.push({ scope: 'vendor', key: v.key, message: '厂商标识重复' });
    }
    seenVendor.add(v.key);

    if (!v.baseUrl) {
      issues.push({ scope: 'vendor', key: v.key, message: '缺少厂商级基址' });
    }
    // ⚠️ 基址必须归一化到根域: 带了 /v1 会让协议层拼出 /v1/v1/...
    if (/\/v1(\/|$)/.test(v.baseUrl)) {
      issues.push({
        scope: 'vendor',
        key: v.key,
        message: `基址含 /v1 段 (${v.baseUrl}) —— 必须归一化到根域, /v1 由协议层补`,
      });
    }
    if (v.baseUrl.endsWith('/')) {
      issues.push({ scope: 'vendor', key: v.key, message: '基址不得以 / 结尾' });
    }

    if (v.channels.length === 0) {
      issues.push({ scope: 'vendor', key: v.key, message: '厂商未声明任何模态通道' });
    }

    const seenModality = new Set<string>();
    for (const c of v.channels) {
      if (seenModality.has(c.modality)) {
        issues.push({
          scope: 'vendor',
          key: v.key,
          message: `模态 ${c.modality} 声明了多条通道 —— 一厂商一模态只应有一条`,
        });
      }
      seenModality.add(c.modality);

      /*
       * ⚠️ 协议查找要**同时**查两份目录:
       *   - PROTOCOL_SPECS         图像/文本 (一次 POST 出结果)
       *   - VIDEO_PROTOCOL_SPECS   视频 (四段式异步契约)
       * 只查前者会把视频通道误判为「引用了协议层不存在的协议」。
       */
      const spec = protocolSpec(c.protocol);
      const videoSpec = videoProtocolSpec(c.protocol);
      if (!spec && !videoSpec) {
        issues.push({
          scope: 'vendor',
          key: v.key,
          message: `引用了协议层不存在的协议 "${c.protocol}"`,
        });
        continue;
      }
      // 模态必须与协议一致: 跨模态协议会把请求发到错误端点
      const specModality = spec?.modality ?? 'video';
      if (specModality !== c.modality) {
        issues.push({
          scope: 'vendor',
          key: v.key,
          message:
            `通道模态 ${c.modality} 与协议 ${c.protocol} 的模态 ${specModality} 不符 —— ` +
            `跨模态协议会把请求发到错误端点`,
        });
      }
      if (c.models.length === 0) {
        issues.push({
          scope: 'vendor',
          key: v.key,
          message: `通道 ${c.modality} 未声明任何模型`,
        });
      }
      if (!c.baseUrl && baseUrlOf(v, c) !== v.baseUrl.replace(/\/+$/, '')) {
        issues.push({ scope: 'vendor', key: v.key, message: '通道基址归一化结果与厂商级不一致' });
      }
    }
  }

  // ── 派生视图: key 不得重复 (重复会让后台配置项互相覆盖) ─────────
  const seenPreset = new Set<string>();
  for (const p of VENDOR_PRESETS) {
    if (seenPreset.has(p.key)) {
      issues.push({ scope: 'preset', key: p.key, message: '派生预设 key 重复 —— 后台配置项会互相覆盖' });
    }
    seenPreset.add(p.key);
  }

  return issues;
}

/**
 * 装配期断言 —— 有问题直接抛。
 *
 * 抛而不 warn: 这些都是**声明错误**, 带着已知缺陷启动等于上线即事故。
 */
export function assertCatalogIntegrity(): void {
  const issues = collectCatalogIssues();
  if (issues.length) {
    throw new Error(
      `[vendor.catalog] 架构分层校验失败 (${issues.length} 项):\n` +
        issues.map((i) => `  - [${i.scope}] ${i.key}: ${i.message}`).join('\n'),
    );
  }
}

/**
 * 跨层一致性: 派生视图的每个字段都能在目录里找到出处。
 *
 * 这条是"单一来源"的**可执行证明** —— 若有人绕过目录直接改了视图
 * (例如手写一条 sizeStyle), 这里会发现它与协议层的声明不一致。
 */
export function collectViewDriftIssues(): CatalogIssue[] {
  const issues: CatalogIssue[] = [];
  for (const p of VENDOR_PRESETS) {
    /*
     * ⚠️ 视频协议在独立目录 (VIDEO_PROTOCOL_SPECS), 只查 PROTOCOL_SPECS
     * 会把合法的视频预设误判为「协议不存在」—— 一个假红灯。
     */
    const spec = protocolSpec(p.protocol);
    const videoSpec = videoProtocolSpec(p.protocol);
    if (!spec && !videoSpec) {
      issues.push({ scope: 'preset', key: p.key, message: `协议 "${p.protocol}" 不存在` });
      continue;
    }
    /*
     * ⚠️ **只对图像模态比对**这三个字段。
     *
     * 文本模态没有尺寸档位与参考图的概念, 视频模态走独立的
     * VideoProtocolSpec (四段式异步) —— 两者对这些字段一律留空,
     * 这不是漂移, 而是模态差异。协议层的 openai-chat 声明了这些字段
     * 仅为让 ProtocolSpec 对两个模态结构一致, 不代表文本通道真能传参考图。
     */
    if (p.modality !== 'image' || !spec) continue;

    if (p.sizeStyle !== spec.sizeStyle) {
      issues.push({
        scope: 'preset',
        key: p.key,
        message: `sizeStyle 漂移: 视图 ${p.sizeStyle} vs 协议层 ${spec.sizeStyle}`,
      });
    }
    if (p.maxRefImages !== spec.maxRefImages) {
      issues.push({
        scope: 'preset',
        key: p.key,
        message: `maxRefImages 漂移: 视图 ${p.maxRefImages} vs 协议层 ${spec.maxRefImages}`,
      });
    }
    if (p.refStyle !== spec.refStyle) {
      issues.push({
        scope: 'preset',
        key: p.key,
        message: `refStyle 漂移: 视图 ${p.refStyle} vs 协议层 ${spec.refStyle}`,
      });
    }
  }
  return issues;
}

/** 装配期统一入口 —— 由 vendors/index.ts 在模块加载时调用 */
export function assertArchitectureIntegrity(): void {
  assertCatalogIntegrity();
  const drift = collectViewDriftIssues();
  if (drift.length) {
    throw new Error(
      `[vendor.presets] 派生视图与协议层不一致 (${drift.length} 项):\n` +
        drift.map((i) => `  - ${i.key}: ${i.message}`).join('\n'),
    );
  }
}

export { specOf };
