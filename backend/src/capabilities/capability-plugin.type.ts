import type { Modality } from '../providers/modality';

/**
 * 能力插件类型 —— 一项能力的**完整**定义 (2026-10-20 抽离为独立可扩展)。
 *
 * ## 为什么把提示词并进能力定义
 *
 * 改造前一项能力的信息散在**四处**, 且没有任何机制保证它们同步:
 *   1. `capability.registry.ts`  — id / 名称 / 参数 / 模态
 *   2. `gateway-prompt.ts`       — 送给模型的提示词 (PROMPTS 字典)
 *   3. `channel-config.defs.ts`  — CAPABILITY_IDS (手工复制的 id 列表)
 *
 * 漏改第 2 处的症状最恶劣: `PROMPTS[capability]?.(…) ?? capability`
 * 会把**裸能力 id 当提示词发给真实模型** (如把字符串 "matting" 当提示词),
 * 不报错、不回落, 只是模型收到一句莫名其妙的话, 产出垃圾图。
 * 漏改第 4 处则导致新能力没有路由配置项, 后台页面少一行且无处可配。
 *
 * 故把「这项能力是什么」收成一个自包含对象, 元信息与提示词
 * 在同一处声明 —— 漏写会在**装配期**被 assertCapabilityIntegrity 拦下,
 * 从「运行时的静默错误」变成「启动时的明确报错」。
 */

export type CapabilityGroup = 'ecommerce_gen' | 'ai_retouch' | 'ai_video';
/**
 * 实现程度。
 *
 * 2026-10-22 起**没有 mock 一档** —— 过去用它标记「只画占位图」的能力,
 * 那批占位实现已全部删除: 能力要么接真实模型 (`real`),
 * 要么尚未开放 (`planned`)。没有真实产出路径的能力不该以任何形式对用户开放。
 */
export type CapabilityMode = 'real' | 'planned';
export type ParamType = 'enum' | 'number' | 'text' | 'boolean';

export interface ParamOption {
  value: string | number;
  label: string;
}

export interface CapabilityParam {
  key: string;
  label: string;
  type: ParamType;
  default?: string | number | boolean;
  options?: ParamOption[];
  min?: number;
  max?: number;
  /**
   * text 参数的最大保留长度（字符数）。
   *
   * `sanitizeParams` 对文本参数默认截断到 2000 字符；需要更长内容的
   * 技术参数（如局部重绘的 annotations JSON）可在此显式放大。
   */
  maxLength?: number;
  /**
   * text 参数的正则约束（完整匹配由 pattern 自身表达）。
   *
   * 用于有强格式要求的协议字段（如 #RRGGBB 颜色）。校验发生在扣费前，
   * 非法值直接 40001，不会经 sanitizeParams 静默回落成默认值。
   */
  pattern?: string;
  step?: number;
  placeholder?: string;
  help?: string;
  /**
   * 不进入通用参数表单（2026-10-22）。
   *
   * 用于**由页面代填的技术参数**（如局部重绘的 `maskAssetId`）：
   * 用户在通用工具页（`/tools/:capability`）里既拿不到素材 id, 填了也没意义,
   * 露出来只会让人以为要手填一串 UUID。
   *
   * ⚠️ 仍必须**声明**该参数 —— `sanitizeParams` 只保留声明过的 key,
   * 不声明的参数会被静默丢弃（遮罩传不过去, 任务照常整图重绘）。
   */
  hidden?: boolean;
}

/**
 * 提示词构造器。
 *
 * 第二个参数是参考图张数 —— 供提示词描述"参考了 N 张图",
 * 过去靠往 params 里塞 `__refCount` 隐式传递,
 * 这里是显式入参, 不再污染业务参数。
 */
export type PromptBuilder = (params: Record<string, any>, refCount: number) => string;

export interface CapabilityPlugin {
  /** 稳定标识; 路由配置项 gateway.route.<id> 由它派生 */
  id: string;
  name: string;
  group: CapabilityGroup;
  /** 工作台卡片上的一句话说明 */
  summary: string;
  /** 侧边导航 hover 提示 */
  sidebarHint?: string;
  /** 卡片角标 */
  badge?: string;
  mode: CapabilityMode;
  /** 产出模态。与 mode 正交: mode 说实现程度, modality 说产出类型 */
  modality: Modality;
  /** 送给真实模型的提示词。**必填** —— 缺失即装配期失败 */
  buildPrompt: PromptBuilder;
  /**
   * 代码默认消耗积分。
   *
   * ⚠️ **必填** (校验器强制): 漏声明会让该能力变成**免费开放** ——
   * 少收钱比多收钱更难被发现 (没有任何报错, 只是收入少了一笔)。
   * 显式写 0 表示「限时免费」, 是合规的; 连字段都没有才是漏。
   *
   * 取价请用 CreditPriceService.resolve() 拿运行时生效价, 不要在业务里
   * 直接读本字段 —— 否则后台改价对生成链路不生效。
   */
  creditCost: number;
  /** 需要上传几张输入图 */
  inputs: 0 | 1 | 2;
  /** 是否在工作台卡片区展示 */
  inWorkbench: boolean;
  /** 能力级提示, 如合规提醒 */
  help?: string;
  params: CapabilityParam[];
}

/**
 * 装配期完整性校验 —— 本次抽离的**核心价值所在**。
 *
 * 把「漏写某处」从运行时的静默错误提前到启动时的明确报错。
 * 具体拦截五类历史上真实发生过的漏改:
 *   1. 缺 buildPrompt  → 裸能力 id 被当提示词发给模型 (不报错, 产出垃圾)
 *   2. 缺 creditCost   → 该能力免费开放 (少收钱比多收钱更难被发现)
 *   3. id 重复 / 空 id  → 路由配置项互相覆盖, 后台页面显示错乱
 *   4. 参数 key 重复   → sanitizeParams 静默覆盖后一项
 *
 * 所有模态都只允许真实模型产出。本地生成算法已于 2026-10-25 删除,
 * 因此这里不再要求或允许声明本地实现句柄。
 *
 * ⚠️ 取代了原先分散在 registry 的 assertCreditCostDeclared: 同一个装配期
 * 只留一道闸, 避免"改了校验器却忘了另一处"的两份真相。
 */
export function assertCapabilityIntegrity(plugins: CapabilityPlugin[]): void {
  const errors: string[] = [];
  const seen = new Set<string>();

  for (const p of plugins) {
    const tag = p.id || '(空 id)';

    if (!p.id) errors.push('存在空 id 的能力定义');
    else if (seen.has(p.id)) errors.push(`能力 id 重复: ${p.id}`);
    seen.add(p.id);

    if (typeof p.buildPrompt !== 'function') {
      errors.push(`能力 ${tag} 未声明 buildPrompt —— 漏写会把裸 id 当提示词发给真实模型`);
    }

    if (typeof p.creditCost !== 'number') {
      errors.push(`能力 ${tag} 未声明 creditCost —— 会导致免费开放（显式写 0 表示限时免费，是合规的）`);
    }

    if (!p.modality) {
      errors.push(`能力 ${tag} 未声明 modality`);
    }

    // 参数重名会让 sanitizeParams 静默覆盖后一项, 属声明错误
    const keys = new Set<string>();
    for (const param of p.params ?? []) {
      if (keys.has(param.key)) errors.push(`能力 ${tag} 的参数 key 重复: ${param.key}`);
      keys.add(param.key);
      if (param.pattern) {
        try {
          new RegExp(param.pattern);
        } catch {
          errors.push(`能力 ${tag} 的参数 ${param.key} 声明了无效正则: ${param.pattern}`);
        }
      }
    }
  }

  if (errors.length) {
    // 抛而不 warn: 这些是**声明错误**, 继续启动等于带着已知缺陷上线
    throw new Error(
      `[capability.registry] 能力注册表完整性校验失败 (${errors.length} 项):\n` +
        errors.map((e) => `  - ${e}`).join('\n'),
    );
  }
}
