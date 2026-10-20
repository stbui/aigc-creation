import type { Modality } from '../providers/modality';

/**
 * 能力插件类型 —— 一项能力的**完整**定义 (2026-10-20 抽离为独立可扩展)。
 *
 * ## 为什么把提示词与本地实现并进能力定义
 *
 * 改造前一项能力的信息散在**四处**, 且没有任何机制保证它们同步:
 *   1. `capability.registry.ts`  — id / 名称 / 参数 / 模态
 *   2. `gateway-prompt.ts`       — 送给模型的提示词 (PROMPTS 字典)
 *   3. `mock-image.provider.ts`  — 本地像素算法 (两处 switch 的 case)
 *   4. `channel-config.defs.ts`  — CAPABILITY_IDS (手工复制的 id 列表)
 *
 * 漏改第 2 处的症状最恶劣: `PROMPTS[capability]?.(…) ?? capability`
 * 会把**裸能力 id 当提示词发给真实模型** (如把字符串 "matting" 当提示词),
 * 不报错、不回落, 只是模型收到一句莫名其妙的话, 产出垃圾图。
 * 漏改第 4 处则导致新能力没有路由配置项, 后台页面少一行且无处可配。
 *
 * 故把「这项能力是什么」收成一个自包含对象, 元信息、提示词、本地实现
 * 在同一处声明 —— 漏写会在**装配期**被 assertCapabilityIntegrity 拦下,
 * 从「运行时的静默错误」变成「启动时的明确报错」。
 */

export type CapabilityGroup = 'ecommerce_gen' | 'ai_retouch' | 'ai_video';
export type CapabilityMode = 'real' | 'mock' | 'planned';
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
  step?: number;
  placeholder?: string;
  help?: string;
}

/**
 * 提示词构造器。
 *
 * 第二个参数是参考图张数 —— 供提示词描述"参考了 N 张图",
 * 过去靠往 params 里塞 `__refCount` 隐式传递 (见 gateway-prompt 的 buildGatewayRequest),
 * 这里是显式入参, 不再污染业务参数。
 */
export type PromptBuilder = (params: Record<string, any>, refCount: number) => string;

/**
 * 本地实现的句柄键 —— 对应 MockImageProvider 上的方法名。
 *
 * ⚠️ 这里存**字符串方法名**而非函数本身, 是为了打破循环依赖:
 * definitions 若 import MockImageProvider, 而后者又要读 definitions 来分派,
 * 就是一个环。所以只登记名字, 由 mock provider 在运行时按名字取自己的方法。
 *
 * 校验器保证名字非空且实际存在 (见 assertCapabilityIntegrity), 因此
 * 「登记了但方法不存在」会在装配期暴露, 而不是运行时 undefined 调用。
 */
export type LocalImplKey =
  | 'makeMainImage'
  | 'makeDetailImage'
  | 'makeClone'
  | 'makeFreeCreation'
  | 'makeMatting'
  | 'makeExpand'
  | 'makeRotate'
  | 'makeRecolor'
  | 'makeEnhance'
  | 'makePlaceholder'
  | 'makeLocalRedraw'
  | 'makeImageTranslate'
  | 'makeMultiFusion'
  | 'makeSkuImage';

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
   * 本地兜底实现的句柄键。
   *
   * ⚠️ **仅 image 模态要求非空**: 文本没有「本地算法」概念 ——
   * 编一段模板文案会让用户误以为是模型产出 (违反本项目既有约定),
   * 视频同理。本地兜底必须真的能出东西, 否则宁可不兜底。
   */
  localImpl?: LocalImplKey;
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
 *   2. image 能力缺 localImpl → 远程失败后没有兜底, 用户拿不到产出
 *   3. 缺 creditCost   → 该能力免费开放 (少收钱比多收钱更难被发现)
 *   4. id 重复 / 空 id  → 路由配置项互相覆盖, 后台页面显示错乱
 *   5. 参数 key 重复   → sanitizeParams 静默覆盖后一项
 *
 * 刻意**不在**这里校验 image 之外模态的 localImpl: 文本/视频本就不该有本地兜底,
 * 对它们提要求等于逼着人造假实现。
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

    // 只有图像模态要求本地兜底
    if (p.modality === 'image' && !p.localImpl) {
      errors.push(`图像能力 ${tag} 未声明 localImpl —— 远程通道失败后将没有本地兜底`);
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

/**
 * localImpl 句柄名 → MockImageProvider 上的实际方法名。
 *
 * 两者字面相同, 但**必须经这张表转换**而不是直接当方法名用:
 * 若校验器直接 `typeof obj[key] === 'function'`, 一项能力只要碰巧写了
 * Object.prototype 上的属性名 (toString / constructor / valueOf) 就会
 * "通过"校验, 运行时调到原型方法上产出诡异结果。经表转换后
 * 未登记的名字一律落空, 被上面的校验拦在装配期。
 */
export const LOCAL_IMPL_METHODS: Record<LocalImplKey, LocalImplKey> = {
  makeMainImage: 'makeMainImage',
  makeDetailImage: 'makeDetailImage',
  makeClone: 'makeClone',
  makeFreeCreation: 'makeFreeCreation',
  makeMatting: 'makeMatting',
  makeExpand: 'makeExpand',
  makeRotate: 'makeRotate',
  makeRecolor: 'makeRecolor',
  makeEnhance: 'makeEnhance',
  makePlaceholder: 'makePlaceholder',
  makeLocalRedraw: 'makeLocalRedraw',
  makeImageTranslate: 'makeImageTranslate',
  makeMultiFusion: 'makeMultiFusion',
  makeSkuImage: 'makeSkuImage',
};