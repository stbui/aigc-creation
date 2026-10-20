import { CAPABILITY_PLUGINS } from './definitions';
import {
  assertCapabilityIntegrity,
  type CapabilityGroup,
  type CapabilityMode,
  type CapabilityParam,
  type CapabilityPlugin,
  type ParamOption,
  type ParamType,
} from './capability-plugin.type';
import { parseDetailSections } from './definitions/param-options';
import type { Modality } from '../providers/modality';

/**
 * 能力清单 —— 全站唯一事实源 (2026-10-20 起为**聚合门面**)。
 *
 * ## 本文件现在转发, 不再定义
 *
 * 改造前能力定义**本体**在这里 (791 行, 15 项)。它的问题是: 一项能力的信息
 * 还散落在另外三处 ——
 *   - 提示词在 `providers/gateway-prompt.ts` 的 PROMPTS 字典
 *   - 本地像素算法分派在 `mock-image.provider.ts` 的两处 switch
 *   - 路由配置项的 id 列表在 `providers/channel-config.defs.ts` 的 CAPABILITY_IDS
 *
 * 于是新增一项能力要改四个文件, 而**漏改不报错**:
 *   漏提示词 → `PROMPTS[cap]?.() ?? cap` 把裸能力 id 当提示词发给真实模型,
 *              不报错不回落, 只是模型收到一句莫名其妙的话, 产出垃圾图
 *   漏 id    → 后台模型配置页少一行路由, 无处可配
 *
 * 现在每项能力是一个自包含对象 (`definitions/<id>.ts`), 元信息 + 提示词 +
 * 本地实现句柄 + 模态 + 积分价都在一处声明, 漏声明由装配期断言拦下。
 *
 * **本文件保留为稳定门面的理由**: 11 处调用点 (generate / credits / admin /
 * stats / dto) 按原路径 import 本文件, 保留门面可让它们一行不改;
 * 新增能力时也只需改 `definitions/` 一处。
 *
 * mode 含义 (语义不变):
 *   real    —— 已接入真实实现, 界面标「已接入」。含两类: Jimp 本地真实算法,
 *              以及已接云端模型的能力 (自由创作 → 优云智算 qwen-image-3.0)。
 *              ⚠️ real ≠「本地算法」: 具体走哪条通道以**每单真实的 task.provider**
 *              为准, 前端结果卡按它显示, 不靠 mode 猜。
 *   mock    —— 依赖真实 AI 模型, 本地生成参数化占位图 (界面标注「占位」)
 *   planned —— 参考站有、本项目暂未实现, 界面标「规划中」且不可提交
 *
 * modality (2026-10-20) 与 mode **正交**: mode 回答「实现到什么程度」,
 * modality 回答「产出是什么」。当前 15 项能力全部产出图片。
 */

export type {
  CapabilityGroup,
  CapabilityMode,
  CapabilityParam,
  CapabilityPlugin,
  ParamOption,
  ParamType,
};

/**
 * 兼容旧类型名。
 *
 * ⚠️ 这是**改名而非语义变更**: 能力定义从 CapabilityDef 抽到 CapabilityPlugin,
 * 两者是同一个类型。保留别名是为了不打断既有引用, 新代码用 CapabilityPlugin。
 */
export type CapabilityDef = CapabilityPlugin;

/** 能力清单 (顺序即侧栏与工作台展示顺序, 与参考站一致) */
export const CAPABILITIES: CapabilityPlugin[] = CAPABILITY_PLUGINS;

const BY_ID = new Map(CAPABILITIES.map((c) => [c.id, c]));

export function getCapability(id: string): CapabilityPlugin | undefined {
  return BY_ID.get(id);
}

export const CAPABILITY_GROUPS: Array<{ id: CapabilityGroup; name: string; desc: string }> = [
  { id: 'ecommerce_gen', name: '电商生图', desc: '电商都在用，广大卖家优选' },
  { id: 'ai_retouch', name: 'AI修图', desc: '存量图二次创作' },
  { id: 'ai_video', name: 'AI视频', desc: '图生视频与短视频' },
];

/** 详情页模块解析 (定义已搬至 definitions/param-options, 此处转发) */
export { parseDetailSections };

/**
 * 能力的代码默认消耗价 (未读 SystemSetting 的裸值)。
 *
 * 与 `CapabilityPlugin.creditCost` 读的是同一个字段, 单列出来是为了让调用方
 * 意图明确 —— 要「当前生效价」请用 CreditPriceService.resolve(),
 * 不要在业务里直接取 def.creditCost, 否则后台改价对生成链路不生效。
 */
export function defaultCreditCostOf(id: string): number {
  const raw = BY_ID.get(id)?.creditCost;
  // 负数是非法配置, 按 0 处理而非透传 —— 负积分消耗会让 consume() 变成反向发放
  return typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0;
}

/**
 * 启动期自检的**兼容入口** —— 委托给 assertCapabilityIntegrity。
 *
 * ⚠️ 保留是因为既有调用方显式调过本函数; 新代码不必再调, 因为
 * `definitions/index.ts` 在被 import 时就已执行过一次同名校验。
 *
 * creditCost 的检查已并入 assertCapabilityIntegrity: 同一个装配期只留一道闸,
 * 避免「改了校验器却忘了另一处」的两份真相。
 */
export function assertCreditCostDeclared(): void {
  assertCapabilityIntegrity(CAPABILITIES);
}

/** DTO 白名单用: 允许提交的能力 = real + mock (planned 不可提交) */
export const SUBMITTABLE_CAPABILITY_IDS: string[] = CAPABILITIES.filter(
  (c) => c.mode !== 'planned',
).map((c) => c.id);

/** 工作台卡片区展示顺序与参考站一致 */
export const WORKBENCH_CAPABILITIES: CapabilityPlugin[] = CAPABILITIES.filter((c) => c.inWorkbench);

/** 能力默认值, 供前端初始化表单 */
export function defaultParamsFor(id: string): Record<string, any> {
  const def = BY_ID.get(id);
  if (!def) return {};
  const out: Record<string, any> = {};
  for (const p of def.params) {
    if (p.default !== undefined) out[p.key] = p.default;
    else if (p.type === 'enum') out[p.key] = p.options?.[0]?.value;
    else if (p.type === 'number') out[p.key] = p.min ?? 0;
    else if (p.type === 'boolean') out[p.key] = false;
    else out[p.key] = '';
  }
  return out;
}

/** 参数越界时收敛到声明区间, 避免前端/外部传入离谱数值打挂图像处理 */
export function sanitizeParams(id: string, params: Record<string, any> | undefined): Record<string, any> {
  const def = BY_ID.get(id);
  if (!def) return {};
  const input = params ?? {};
  const out: Record<string, any> = {};
  for (const p of def.params) {
    const raw = input[p.key];
    if (raw === undefined || raw === null || raw === '') {
      out[p.key] = defaultParamsFor(id)[p.key];
      continue;
    }
    if (p.type === 'number') {
      let n = Number(raw);
      if (!Number.isFinite(n)) n = Number(p.default ?? p.min ?? 0);
      if (p.min !== undefined) n = Math.max(p.min, n);
      if (p.max !== undefined) n = Math.min(p.max, n);
      out[p.key] = n;
    } else if (p.type === 'boolean') {
      out[p.key] = raw === true || raw === 'true' || raw === 1 || raw === '1';
    } else {
      // enum: 只接受声明过的选项, 否则回落默认值 (防止前端加项后端不认)
      if (p.type === 'enum' && p.options && !p.options.some((o) => o.value === raw)) {
        out[p.key] = p.default ?? p.options[0]?.value;
      } else {
        out[p.key] = String(raw).slice(0, 2000);
      }
    }
  }
  return out;
}

export type { Modality };