import { parseCredits, toCreditsInput } from '../../../lib/microcredits';
import type { AdminChannelModelView, ChannelModelPriceTierView } from '../../../types/model';

/** 供应侧模态：与 `ChannelModel.capability` 同一命名空间（不是 C 端能力 id） */
export const CAPABILITY_OPTIONS = [
  { value: 'image', label: '图像' },
  { value: 'text', label: '文本' },
  { value: 'video', label: '视频' },
  { value: 'audio', label: '音频' },
];

/**
 * 清单状态筛选。
 *
 * 「未定价」是本仓特有的一档：没有已配置价格档的模型不会被报价，也不该被
 * 线路选用。导入上游目录后模型默认停用且未定价，这一档就是补价工作队列。
 */
export const STATUS_FILTER_OPTIONS = [
  { value: 'enabled', label: '已启用' },
  { value: 'disabled', label: '已停用' },
  { value: 'unpriced', label: '未定价' },
];

export const PAGE_SIZE = 20;

export const BILLING_MODE_OPTIONS = [
  { value: 'fixed_request', label: '按次' },
  { value: 'per_second', label: '按时长（秒）' },
  { value: 'token', label: '按 Token 用量' },
];

export const CURRENCY_OPTIONS = [
  { value: 'credits', label: '积分' },
  { value: 'USD', label: '美元' },
  { value: 'CNY', label: '人民币' },
];

export const TAG_COLOR_OPTIONS = ['purple', 'blue', 'green', 'gold', 'orange', 'pink'];

export interface TierDraft {
  selector: string;
  resolution: string;
  videoSeconds: string;
  providerModelKey: string;
  billingMode: string;
  unit: string;
  input: string;
  output: string;
  cached: string;
  costConfigured: boolean;
  costUnit: string;
  costInput: string;
  costOutput: string;
  costCached: string;
  priceConfigured: boolean;
  enabled: boolean;
}

export interface ModelDraft {
  modelKey: string;
  providerModelKey: string;
  displayName: string;
  channelLabel: string;
  description: string;
  icon: string;
  capability: string;
  protocol: string;
  priceCurrency: string;
  tags: string;
  capabilityConfig: string;
  enabled: boolean;
  tiers: TierDraft[];
}

export const EMPTY_TIER: TierDraft = {
  selector: '',
  resolution: '*',
  videoSeconds: '0',
  providerModelKey: '',
  billingMode: 'fixed_request',
  unit: '0',
  input: '0',
  output: '0',
  cached: '0',
  costConfigured: false,
  costUnit: '0',
  costInput: '0',
  costOutput: '0',
  costCached: '0',
  priceConfigured: false,
  enabled: true,
};

export const EMPTY_DRAFT: ModelDraft = {
  modelKey: '',
  providerModelKey: '',
  displayName: '',
  channelLabel: '',
  description: '',
  icon: '',
  capability: 'image',
  protocol: '',
  priceCurrency: 'credits',
  tags: '',
  capabilityConfig: '',
  enabled: true,
  tiers: [{ ...EMPTY_TIER }],
};

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

export function toDraft(model: AdminChannelModelView): ModelDraft {
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

export function priceOf(text: string, label: string): number {
  const value = parseCredits(text);
  if (value === null) throw new Error(`${label}格式不正确，请填积分，最多 6 位小数`);
  return value;
}
