/**
 * 渠道工作台的纯函数与外部工具入口 —— 目录内文件的唯一外部工具来源。
 *
 * 约定:
 *   - 本文件内的函数不依赖 React，可被页面、组件与 hooks 共用；
 *   - 目录内文件不从 `src/lib/<工具>` 直接取东西，一律经由本文件；
 *   - 常量、类型与默认值在 `constants.ts`，外部接口 / 控件 / hook 分别走
 *     `api.ts` / `components.ts` / `hooks.ts`。
 * 目录内新增外部工具引用时在这里补一行 re-export。
 */

import { formatAmount, formatMarkupPercent, markupPercent, tierPriceLines } from '../../../lib/channelCost';
import { moveOrderItem, orderChanged, type OrderItem } from '../../../lib/channelOrder';
import {
  MAX_REPRICE_MARKUP_PERCENT,
  MAX_REPRICE_MODELS,
  buildRepriceRows,
  computeRepriceSale,
  formatMarkup,
  isValidMarkup,
  parseSaleInput,
  repriceBlockingModels,
  saleInputValue,
  type RepriceRow,
} from '../../../lib/channelReprice';
import { parseCredits, toCreditsInput } from '../../../lib/microcredits';
import type {
  AdminChannelModelView,
  AdminChannelView,
  ChannelModelPriceTierView,
} from '../../../types/model';
import {
  EMPTY_TIER,
  type ChannelDraft,
  type ChannelHeader,
  type ModelDraft,
  type TierDraft,
} from './constants';
import { createDefaultTextCapabilityConfigJson } from './textCapability';

/* 外部工具转出：目录内文件不直接引 `src/lib/*` */
export {
  MAX_REPRICE_MARKUP_PERCENT,
  MAX_REPRICE_MODELS,
  buildRepriceRows,
  computeRepriceSale,
  formatAmount,
  formatMarkup,
  formatMarkupPercent,
  isValidMarkup,
  markupPercent,
  moveOrderItem,
  orderChanged,
  parseCredits,
  parseSaleInput,
  repriceBlockingModels,
  saleInputValue,
  tierPriceLines,
  toCreditsInput,
  type OrderItem,
  type RepriceRow,
};

/* ------------------------------------------------------------------------- */
/* 商品状态                                                                  */
/* ------------------------------------------------------------------------- */

/**
 * 商品对运营的三个结论，外加“还没配完”。
 *
 * 优先级刻意是「待配置 > 已停用 > 待定价 > 可用」：上游导入的骨架行同时
 * 满足“停用”和“缺能力 / 协议”，先报「待配置」才能把人带到要补的字段，
 * 而不是让他去点一个没有意义的启用开关。
 */
export type ProductState = 'available' | 'unpriced' | 'unconfigured' | 'disabled';

export const PRODUCT_STATE_META: Record<
  ProductState,
  { label: string; tone: 'success' | 'warn' | 'muted' }
> = {
  available: { label: '可用', tone: 'success' },
  unpriced: { label: '待定价', tone: 'warn' },
  unconfigured: { label: '待配置', tone: 'warn' },
  disabled: { label: '已停用', tone: 'muted' },
};

export function productStateOf(
  model: Pick<AdminChannelModelView, 'capability' | 'protocol' | 'enabled' | 'priceConfigured'>,
  channelEnabled = true,
): ProductState {
  if (!model.capability.trim() || !model.protocol.trim()) return 'unconfigured';
  if (!model.enabled || !channelEnabled) return 'disabled';
  if (!model.priceConfigured) return 'unpriced';
  return 'available';
}

/* ------------------------------------------------------------------------- */
/* 自定义请求头校验                                                          */
/* ------------------------------------------------------------------------- */

/** 与 `backend/src/model/infra/outbound.ts` 的 `DEFAULT_USER_AGENT` 保持一致 */
export const DEFAULT_USER_AGENT = 'huojue/1.0';
export const MAX_HEADER_COUNT = 32;
const MAX_HEADER_BYTES = 16 * 1024;
const MAX_NAME_LENGTH = 128;
const MAX_VALUE_LENGTH = 4096;
const HEADER_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

/** 与后端 `blockedOutboundHeader` 同一份名单：这些头由出站层或协议适配器写入 */
const BLOCKED_HEADERS = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'host',
  'content-length',
  'content-type',
  'accept',
  'connection',
  'proxy-connection',
  'keep-alive',
  'transfer-encoding',
  'te',
  'trailer',
  'upgrade',
  'forwarded',
  'x-goog-api-key',
]);

/** 值里只允许可打印 ASCII 与横向制表符（与后端逐字符判定一致） */
function hasControlChar(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 9 || (code >= 32 && code !== 127)) continue;
    return true;
  }
  return false;
}

/**
 * 返回第一条错误文案；空串表示通过。
 *
 * 空行（名称与值都为空）直接跳过，不算错误 —— 用户点了「添加请求头」还没填时
 * 不应该被报错打断。
 */
export function validateChannelHeaders(headers: ChannelHeader[]): string {
  if (headers.length === 0) return '';
  if (headers.length > MAX_HEADER_COUNT) return `附加信息最多支持 ${MAX_HEADER_COUNT} 项`;
  const seen = new Set<string>();
  let total = 0;
  for (const header of headers) {
    const name = header.name.trim();
    const value = header.value.trim();
    if (!name && !value) continue;
    if (!name || !HEADER_NAME_PATTERN.test(name)) {
      return '附加信息名称无效，请检查名称格式';
    }
    const lower = name.toLowerCase();
    if (BLOCKED_HEADERS.has(lower) || lower.startsWith('x-canvas-') || lower.startsWith('x-forwarded-')) {
      return `${name} 由系统管理，不允许自定义`;
    }
    if (seen.has(lower)) return `附加信息不能重复：${name}`;
    if (hasControlChar(value)) return `${name} 的内容包含不支持的字符`;
    if (name.length > MAX_NAME_LENGTH || value.length > MAX_VALUE_LENGTH) {
      return '单项附加信息名称或内容过长';
    }
    total += name.length + value.length;
    if (total > MAX_HEADER_BYTES) return '附加信息总计不能超过 16KB';
    seen.add(lower);
  }
  return '';
}

/** 提交前裁掉首尾空白并丢弃空行，与服务端 `normalizeOutboundHeaders` 的落库形态一致 */
export function normalizeChannelHeaders(headers: ChannelHeader[]): ChannelHeader[] {
  return headers
    .map((header) => ({ name: header.name.trim(), value: header.value.trim() }))
    .filter((header) => header.name !== '' || header.value !== '');
}

/* ------------------------------------------------------------------------- */
/* 草稿转换                                                                  */
/* ------------------------------------------------------------------------- */

/** 渠道实体 → 表单草稿；凭证不回读，留空表示不修改 */
export function toChannelDraft(channel: AdminChannelView): ChannelDraft {
  return {
    name: channel.name,
    baseUrl: channel.baseUrl,
    apiKey: '',
    secretKey: '',
    proxyUrl: channel.proxyUrl,
    // 并发 0 表示跟随全局上限
    useGlobalConcurrency: channel.concurrencyLimit === 0,
    concurrencyLimit: String(channel.concurrencyLimit || 8),
    enabled: channel.enabled,
    sortOrder: String(channel.sortOrder ?? 0),
    headers: channel.headers ?? [],
  };
}

export function tierToDraft(tier: ChannelModelPriceTierView): TierDraft {
  return {
    selector: formatSelector(tier.selector),
    resolution: tier.resolution || '*',
    videoSeconds: String(tier.videoSeconds ?? 0),
    providerModelKey: tier.providerModelKey,
    billingMode: tier.billingMode,
    unit: toCreditsInput(tier.unitPriceMicrocredits),
    input: toCreditsInput(tier.inputTokenPriceMicrocredits),
    output: toCreditsInput(tier.outputTokenPriceMicrocredits),
    cached: toCreditsInput(tier.cachedTokenPriceMicrocredits),
    costConfigured: tier.costPricing?.configured ?? false,
    costUnit: toCreditsInput(tier.costPricing?.unitPriceMicrocredits ?? 0),
    costInput: toCreditsInput(tier.costPricing?.inputTokenPriceMicrocredits ?? 0),
    costOutput: toCreditsInput(tier.costPricing?.outputTokenPriceMicrocredits ?? 0),
    costCached: toCreditsInput(tier.costPricing?.cachedTokenPriceMicrocredits ?? 0),
    priceConfigured: tier.priceConfigured,
    enabled: tier.enabled,
  };
}

/**
 * 价格档的前端硬校验（与后端 `validateChannelModelTierPricing` 同口径）。
 *
 * 后端会兜住，但只在保存时报错。运营填完一整屏再被拒是浪费；
 * 这里在提交前先拦下最常见的三类问题：
 *   1. 多个「通配规格」（selector 为空）默认档 —— 选价时不知道命中哪个；
 *   2. 计费方式与产出能力不匹配（图片按秒、图像按 Token）；
 *   3. Token 计费缺输出价（必然报 0 价）。
 */
export function validateModelTiers(
  capability: string,
  tiers: Array<{ selector: string; billingMode: string; enabled: boolean; output: string }>,
): string | null {
  const active = tiers.filter((tier) => tier.enabled);
  if (active.length === 0) return '至少保留一个启用的售价方案';

  const wildcards = active.filter((tier) => tier.selector.trim() === '');
  if (wildcards.length > 1) {
    return '只能有一个默认适用规格：其余方案请填写适用规格';
  }

  for (const tier of active) {
    const mode = tier.billingMode;
    if (mode === 'per_second' && capability !== 'video' && capability !== 'audio') {
      return '按时长计价仅适用于视频或音频模型';
    }
    if (mode === 'token') {
      if (capability !== 'text') {
        return '按用量计价目前仅适用于文本模型';
      }
      if (!tier.output || tier.output.trim() === '0') {
        return '按用量计价必须填写输出用量价格';
      }
    }
  }
  return null;
}

/** 价格档提交体：金额已从「积分」换算为微积分 */
export interface PriceTierPayload {
  selector: Record<string, string>;
  resolution: string;
  videoSeconds: number;
  providerModelKey: string;
  billingMode: string;
  unitPriceMicrocredits: number;
  inputTokenPriceMicrocredits: number;
  outputTokenPriceMicrocredits: number;
  cachedTokenPriceMicrocredits: number;
  priceConfigured: boolean;
  enabled: boolean;
  costPricing: {
    configured: boolean;
    unitPriceMicrocredits: number;
    inputTokenPriceMicrocredits: number;
    outputTokenPriceMicrocredits: number;
    cachedTokenPriceMicrocredits: number;
  } | null;
}

/**
 * 草稿里的价格档 → 提交体。
 *
 * 校验与换算放在一处：先过 `validateModelTiers`（计费方式 / 通配档），
 * 再逐档换算微积分。任一价格格式错误都把文案原样返回，由页面提示。
 */
export function buildPriceTiers(
  draft: ModelDraft,
): { error: string } | { tiers: PriceTierPayload[] } {
  const tierError = validateModelTiers(draft.capability, draft.tiers);
  if (tierError) return { error: tierError };

  const modelKey = draft.modelKey.trim();
  try {
    const tiers = draft.tiers
      .filter((tier) => tier.enabled || tier.unit !== '0' || tier.output !== '0')
      .map((tier) => {
        /*
         * 填了非零售价即视为已定价，不再要求额外勾“价格已核对”。
         * 0 积分免费商品由高级区的「按 0 积分免费提供」显式声明；
         * 这样漏勾只会让免费商品保持未定价，不会让正常售价静默失效。
         */
        const priceConfigured =
          tier.priceConfigured ||
          hasNonZeroCredit(tier.unit) ||
          hasNonZeroCredit(tier.input) ||
          hasNonZeroCredit(tier.output) ||
          hasNonZeroCredit(tier.cached);
        const costConfigured =
          tier.costConfigured ||
          hasNonZeroCredit(tier.costUnit) ||
          hasNonZeroCredit(tier.costInput) ||
          hasNonZeroCredit(tier.costOutput) ||
          hasNonZeroCredit(tier.costCached);
        return {
          selector: parseSelector(tier.selector),
          resolution: tier.resolution.trim() || '*',
          videoSeconds: Number(tier.videoSeconds) || 0,
          providerModelKey: tier.providerModelKey.trim() || draft.providerModelKey.trim() || modelKey,
          billingMode: tier.billingMode,
          unitPriceMicrocredits: priceOf(tier.unit, '价格'),
          inputTokenPriceMicrocredits: priceOf(tier.input, '输入用量价格'),
          outputTokenPriceMicrocredits: priceOf(tier.output, '输出用量价格'),
          cachedTokenPriceMicrocredits: priceOf(tier.cached, '缓存内容价格'),
          priceConfigured,
          enabled: tier.enabled,
          costPricing: costConfigured
            ? {
                configured: true,
                unitPriceMicrocredits: priceOf(tier.costUnit, '成本单价'),
                inputTokenPriceMicrocredits: priceOf(tier.costInput, '输入用量成本'),
                outputTokenPriceMicrocredits: priceOf(tier.costOutput, '输出用量成本'),
                cachedTokenPriceMicrocredits: priceOf(tier.costCached, '缓存内容成本'),
              }
            : null,
        };
      });
    return { tiers };
  } catch (e) {
    return { error: e instanceof Error ? e.message : '价格格式不正确' };
  }
}

/** 渠道模型实体 → 表单草稿；没有价格档时给一条继承上游键的通配档 */
export function toModelDraft(model: AdminChannelModelView): ModelDraft {
  return {
    modelKey: model.modelKey,
    providerModelKey: model.providerModelKey,
    displayName: model.displayName,
    channelLabel: model.channelLabel,
    description: model.description,
    icon: model.icon,
    capability: model.capability || 'image',
    protocol: model.protocol,
    priceCurrency: model.priceCurrency || 'credits',
    tags: (model.tags ?? []).map((tag) => ({ text: tag.text, color: tag.color })),
    capabilityConfig: model.capabilityConfig
      ? JSON.stringify(model.capabilityConfig, null, 2)
      : model.capability === 'text'
        ? createDefaultTextCapabilityConfigJson()
        : '',
    enabled: model.enabled,
    tiers:
      model.priceTiers.length > 0
        ? model.priceTiers.map(tierToDraft)
        : [{ ...EMPTY_TIER, providerModelKey: model.providerModelKey }],
  };
}

/**
 * 档位仍指向旧上游模型 key 的档位。
 *
 * 模型级上游键改名后，档位级的 `providerModelKey` 不会自动跟随 ——
 * 请求仍会发到旧的上游 SKU。用户表现为「改了上游却不生效」，且界面
 * 没有任何提示。参考实现（open-ai-canvas `channel-model-price-tier-fields.tsx`）
 * 会算出这批档位并给出「清除并跟随模型」的入口。
 *
 * 只有「档位上游键 == 旧模型上游键」这种**隐式跟随**才算过时；
 * 管理员显式配的其它上游 SKU 不受影响。
 */
export function staleTierUpstream(
  draft: ModelDraft,
  previousProviderModelKey: string,
): number[] {
  const previous = previousProviderModelKey.trim();
  if (!previous) return [];
  const current = draft.providerModelKey.trim();
  if (!current || current === previous) return [];
  return draft.tiers
    .map((tier, index) => (tier.providerModelKey.trim() === previous ? index : -1))
    .filter((index) => index >= 0);
}

/** 把这批档位的上游键清空，改回「跟随模型默认」 */
export function clearStaleTierUpstream(draft: ModelDraft, indexes: number[]): ModelDraft {
  return {
    ...draft,
    tiers: draft.tiers.map((tier, index) =>
      indexes.includes(index) ? { ...tier, providerModelKey: '' } : tier,
    ),
  };
}

/* ------------------------------------------------------------------------- */
/* 选择器 / 标签 / 价格                                                      */
/* ------------------------------------------------------------------------- */

/** 选择器文本 ⇄ 对象：`operation=generate, size=1024x1024` */
export function parseSelector(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const part of String(text ?? '').split(',')) {
    const [rawKey, ...rest] = part.split('=');
    const key = String(rawKey ?? '').trim();
    const value = rest.join('=').trim();
    if (key && value) result[key] = value;
  }
  return result;
}

export function formatSelector(selector: Record<string, string>): string {
  return Object.entries(selector ?? {})
    .map(([key, value]) => `${key}=${value}`)
    .join(', ');
}

/** 标签颜色（与参考实现 `lib/model-tags.ts` 的 6 色一致） */
export const TAG_COLOR_LABELS: Record<string, string> = {
  purple: '紫色',
  blue: '蓝色',
  green: '绿色',
  gold: '金色',
  orange: '橙色',
  pink: '粉色',
};

/** 展示标签：最多 5 个，每个 1–12 字，文字不可重复（与后端校验同口径） */
export const MAX_MODEL_TAGS = 5;
export const MAX_TAG_TEXT_LENGTH = 12;

/** 标签校验：返回错误文案，无错返回 null */
export function validateModelTags(tags: Array<{ text: string; color: string }>): string | null {
  const list = (tags ?? []).filter((tag) => tag.text.trim() !== '');
  if (list.length > MAX_MODEL_TAGS) return `最多添加 ${MAX_MODEL_TAGS} 个标签`;
  for (const tag of list) {
    const length = [...tag.text.trim()].length;
    if (length < 1 || length > MAX_TAG_TEXT_LENGTH) {
      return `标签文字须为 1–${MAX_TAG_TEXT_LENGTH} 字`;
    }
  }
  const texts = list.map((tag) => tag.text.trim());
  if (new Set(texts).size !== texts.length) return '标签文字不能重复';
  return null;
}

export function priceOf(text: string, label: string): number {
  const value = parseCredits(text);
  if (value === null) throw new Error(`${label}格式不正确，请填积分，最多 6 位小数`);
  return value;
}

/** 输入框里有正的积分值；空串 / 0 / 非法值都算“没填” */
export function hasNonZeroCredit(text: string): boolean {
  const value = parseCredits(text);
  return value !== null && value > 0;
}

/* ------------------------------------------------------------------------- */
/* 健康指标展示                                                              */
/* ------------------------------------------------------------------------- */

/** 成功率 → 语义色 */
export function healthTone(rate: number | null, samples: number): 'success' | 'warn' | 'danger' | 'muted' {
  if (rate === null || samples === 0) return 'muted';
  if (rate >= 0.95) return 'success';
  if (rate >= 0.8) return 'warn';
  return 'danger';
}

/**
 * 成功率展示。
 *
 * 只有**恰好 100%** 时才省略小数尾巴 —— 参考实现的口径是「≥ 99.5% 显示
 * 0 位小数」，那会让 99.5% 显示成 `100%`：一条十天挂一次的线在界面上
 * 读起来像是「从没失败过」。1 位小数在这个量级下足够精确，且不会说谎。
 */
export function formatRate(rate: number | null): string {
  if (rate === null) return '—';
  return `${(rate * 100).toFixed(rate === 0 || rate === 1 ? 0 : 1)}%`;
}
