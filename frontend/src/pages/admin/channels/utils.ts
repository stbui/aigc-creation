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
  TAG_COLOR_OPTIONS,
  type ChannelDraft,
  type ChannelHeader,
  type ModelDraft,
  type TierDraft,
} from './constants';

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
/* 自定义请求头校验                                                          */
/* ------------------------------------------------------------------------- */

/** 与 `backend/src/model/infra/outbound.ts` 的 `DEFAULT_USER_AGENT` 保持一致 */
export const DEFAULT_USER_AGENT = 'ecom-vision/1.0';
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
  if (headers.length > MAX_HEADER_COUNT) return `自定义请求头最多支持 ${MAX_HEADER_COUNT} 项`;
  const seen = new Set<string>();
  let total = 0;
  for (const header of headers) {
    const name = header.name.trim();
    const value = header.value.trim();
    if (!name && !value) continue;
    if (!name || !HEADER_NAME_PATTERN.test(name)) {
      return '请求头名称无效，请使用标准 HTTP Header 名称';
    }
    const lower = name.toLowerCase();
    if (BLOCKED_HEADERS.has(lower) || lower.startsWith('x-canvas-') || lower.startsWith('x-forwarded-')) {
      return `${name} 由系统管理，不允许自定义`;
    }
    if (seen.has(lower)) return `请求头不能重复：${name}`;
    if (hasControlChar(value)) return `${name} 的值包含非法控制字符`;
    if (name.length > MAX_NAME_LENGTH || value.length > MAX_VALUE_LENGTH) {
      return '单个请求头名称或值过长';
    }
    total += name.length + value.length;
    if (total > MAX_HEADER_BYTES) return '自定义请求头总大小不能超过 16KB';
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
    reason: '',
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
    tags: tagsToText(model.tags),
    capabilityConfig: model.capabilityConfig ? JSON.stringify(model.capabilityConfig, null, 2) : '',
    enabled: model.enabled,
    tiers:
      model.priceTiers.length > 0
        ? model.priceTiers.map(tierToDraft)
        : [{ ...EMPTY_TIER, providerModelKey: model.providerModelKey }],
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

export function tagsToText(tags: Array<{ text: string; color: string }>): string {
  return (tags ?? []).map((tag) => `${tag.text}:${tag.color}`).join(', ');
}

/** 标签文本 → 请求体；颜色非法时回落 purple，不让一个笔误阻断保存 */
export function textToTags(text: string): Array<{ text: string; color: string }> {
  return String(text ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const [rawText, rawColor] = item.split(':');
      const color = TAG_COLOR_OPTIONS.includes(String(rawColor ?? '').trim())
        ? String(rawColor).trim()
        : 'purple';
      return { text: String(rawText ?? '').trim(), color };
    })
    .filter((tag) => tag.text !== '');
}

export function priceOf(text: string, label: string): number {
  const value = parseCredits(text);
  if (value === null) throw new Error(`${label}格式不正确，请填积分，最多 6 位小数`);
  return value;
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
