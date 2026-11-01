/**
 * 渠道模型「成本价 / 销售价 / 加价率」的展示口径（纯函数）。
 *
 * ## 为什么成本与售价必须并排
 *
 * 渠道模型的价格档里存着两套价：`costPricing`（上游成本）与售价字段
 * （卖给用户的积分）。分开看会漏掉最关键的一个问题：**这条线在亏钱**。
 * 并排展示 + 加价率，运营一眼就能看出「这条线加价 0%，是在原价卖」。
 *
 * ## 币种口径
 *
 * 售价可以按积分 / USD / CNY 三种货币计价。加价率只有在「成本与售价同币种」
 * 时才有意义 —— 货币计价时成本仍以积分计（`priceCurrency` 决定售价币种，
 * 兑换比例按用户分组走），此时**不推算加价率**，只并列展示两个数与单位。
 *
 * ## 加价率的算法
 *
 * 加价率 =（售价 − 成本）÷ 成本。成本为 0 时无意义（显示「—」）——
 * 零成本线的加价率是数学上的无穷大，不该显示成一个数字。
 */

import { toCredits } from './microcredits';
import type { ChannelModelPriceTierView, ChannelModelSalePriceField } from '../types/model';

/** 价格档里参与售价的字段（与 `channelReprice.repricePriceFields` 同源） */
export interface PriceFieldMeta {
  key: ChannelModelSalePriceField;
  label: string;
  unit: string;
}

/** 计费方式决定参与售价的字段 */
export function priceFields(capability: string, billingMode: string): PriceFieldMeta[] {
  if (billingMode !== 'token') {
    return [{ key: 'unitPriceMicrocredits', label: '', unit: billingMode === 'per_second' ? '秒' : '次' }];
  }
  if (capability === 'video') {
    return [{ key: 'outputTokenPriceMicrocredits', label: '视频', unit: '百万视频 Token' }];
  }
  return [
    { key: 'inputTokenPriceMicrocredits', label: '输入', unit: '百万 Token' },
    { key: 'outputTokenPriceMicrocredits', label: '输出', unit: '百万 Token' },
    { key: 'cachedTokenPriceMicrocredits', label: '缓存', unit: '百万 Token' },
  ];
}

/** 图片质量 / 分辨率档位的中文标签 */
const QUALITY_LABELS: Record<string, string> = {
  auto: '自动',
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '超高',
  max: '最高',
  '1k': '1K',
  '2k': '2K',
  '4k': '4K',
};

function qualityLabel(value: string): string {
  const normalized = String(value ?? '').trim().toLowerCase();
  return QUALITY_LABELS[normalized] ?? value;
}

/** 作业类型的中文标签 */
const OPERATION_LABELS: Record<string, string> = {
  text_to_image: '文生图',
  image_to_image: '图生图',
  text_to_video: '文生视频',
  image_to_video: '图生视频',
  video_to_video: '视频生视频',
  text_generation: '文本生成',
};

/**
 * 价格档的规格标签（人类可读）。
 *
 * 与 `channelReprice.tierSpecLabel` 的区别：那个是给调价表格用的原始键值
 * （`operation=text_to_image`），这个是把常见规格翻译成人话（「文生图 · 2K」），
 * 用于列表里的「规格」列。
 */
export function specificationLabel(tier: ChannelModelPriceTierView): string {
  const selector = tier.selector ?? {};
  const specific = (value: string | undefined) =>
    value && value !== '*' ? String(value) : '';
  const operation = specific(selector.operation);
  const resolution = specific(selector.vquality) || specific(tier.resolution);
  const duration = specific(selector.videoSeconds) || (tier.videoSeconds ? String(tier.videoSeconds) : '');
  const parts = [
    operation ? OPERATION_LABELS[operation] ?? operation : '',
    qualityLabel(specific(selector.quality)),
    qualityLabel(specific(selector.resolution)),
    specific(selector.size),
    resolution.toUpperCase(),
    duration ? `${duration} 秒` : '',
    specific(selector.imageCount) ? `${selector.imageCount} 张参考图` : '',
    selector.videoGenerateAudio === 'true' ? '有声' : selector.videoGenerateAudio === 'false' ? '无声' : '',
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : '默认规格';
}

/** 一条价格档的展示行 */
export interface TierPriceLine {
  tierId: string;
  specLabel: string;
  field: PriceFieldMeta;
  /** 成本（微积分）；未配置为 null */
  cost: number | null;
  /** 售价（微积分）；未配置为 null */
  sale: number | null;
}

/** 取模型已启用价格档的展示行 */
export function tierPriceLines(
  capability: string,
  tiers: ChannelModelPriceTierView[],
): TierPriceLine[] {
  const lines: TierPriceLine[] = [];
  for (const tier of tiers) {
    if (!tier.enabled) continue;
    for (const field of priceFields(capability, tier.billingMode)) {
      lines.push({
        tierId: tier.id,
        specLabel: specificationLabel(tier),
        field,
        cost: tier.costPricing?.configured ? tier.costPricing[field.key] ?? null : null,
        sale: tier.priceConfigured ? tier[field.key] ?? null : null,
      });
    }
  }
  return lines;
}

/**
 * 加价率：（售价 − 成本）÷ 成本。
 *
 * 成本为 0 或未配置时返回 null（显示「—」）—— 零成本线的加价率是数学上的
 * 无穷大，显示成一个数字会误导。
 */
export function markupPercent(cost: number | null, sale: number | null): number | null {
  if (cost === null || sale === null) return null;
  if (cost === 0) return null;
  return ((sale - cost) * 100) / cost;
}

/** 加价率展示文本 */
export function formatMarkupPercent(cost: number | null, sale: number | null): string {
  const percent = markupPercent(cost, sale);
  if (percent === null) return '—';
  return `${percent.toFixed(2)}%`;
}

/** 金额展示（微积分 → 积分文本） */
export function formatAmount(microcredits: number | null): string {
  if (microcredits === null) return '未配置';
  return toCredits(microcredits);
}
