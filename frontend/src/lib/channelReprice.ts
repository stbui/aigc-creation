/**
 * 渠道模型「统一调价」的金额换算（纯函数，无副作用）。
 *
 * 后端只接受**最终售价**（`batch-reprice` 的 `prices`），换算在前端做：
 *   售价 = 成本 × (1 + 加价率)，四舍五入（half-up），在所选积分精度上一次取整。
 *
 * 为什么用 BigInt 而不是浮点：成本常是 0.0002 积分（200 微积分）这种量级，
 * `0.0002 * 1.15` 在双精度下拿到的是 0.00022999999999999998，
 * 再 `toFixed` 会掉进「四舍五入到 6 位小数时差一个微积分」的坑 ——
 * 批量几百个档位时这个误差会变成真实的对账差额。
 *
 * 精度口径与后端一致：1 积分 = 1,000,000 微积分（`CREDIT_SCALE`），
 * 可展示 0–6 位小数，对应「保留 N 位小数」= 取整到 `10^(6-N)` 微积分。
 */

import type {
  AdminChannelModelView,
  ChannelModelPriceTierView,
  ChannelModelSalePriceField,
} from '../types/model';

/** 1 积分对应的微积分数量（与后端 `CREDIT_SCALE` 一致） */
const CREDIT_SCALE = 1_000_000n;

/** 加价率上限（百分比） */
export const MAX_REPRICE_MARKUP_PERCENT = 1000;

/** 加价率最多两位小数 */
const MAX_MARKUP_DECIMALS = 2;

/** 单次调价的价格档上限（与后端 `MAX_CHANNEL_MODEL_BATCH_REPRICE` 对齐） */
export const MAX_REPRICE_MODELS = 100;

/** 单价上限：1,000,000 积分（与后端 `MAX_CREDIT_COST_MICROCREDITS` 一致） */
const MAX_PRICE_MICROCREDITS = 1_000_000n * CREDIT_SCALE;

/** 售价字段的展示元信息 */
export interface RepricePriceField {
  key: ChannelModelSalePriceField;
  /** 字段中文名（Token 计费才有区分） */
  label: string;
  /** 计价单位 */
  unit: string;
}

/**
 * 当前计费方式下参与售价的字段。
 *
 * 与后端 `salePriceFields()` 逐字一致：按次 / 按秒只有单价；Token 计费下
 * 视频只按视频用量计费（输入与缓存 Token 恒为 0），文本与其它模态三项都要。
 */
export function repricePriceFields(
  capability: string,
  billingMode: string,
): RepricePriceField[] {
  if (billingMode !== 'token') {
    return [
      {
        key: 'unitPriceMicrocredits',
        label: '单价',
        unit: billingMode === 'per_second' ? '秒' : '次',
      },
    ];
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

/** 加价率合法性：0–1000，最多两位小数 */
export function isValidMarkup(percent: number): boolean {
  if (!Number.isFinite(percent)) return false;
  if (percent < 0 || percent > MAX_REPRICE_MARKUP_PERCENT) return false;
  return Math.abs(percent * 100 - Math.round(percent * 100)) < 1e-8;
}

/**
 * 按加价率算新售价：成本 × (1 + 加价率)，half-up 取整到所选小数位。
 *
 * 返回微积分整数；成本非法或结果超限时返回 null（由调用方给出可读提示）。
 */
export function computeRepriceSale(
  costMicrocredits: number,
  markupPercent: number,
  decimalPlaces: number,
): number | null {
  if (!Number.isSafeInteger(costMicrocredits) || costMicrocredits < 0) return null;
  if (!isValidMarkup(markupPercent)) return null;
  if (!Number.isInteger(decimalPlaces) || decimalPlaces < 0 || decimalPlaces > 6) return null;
  const cost = BigInt(costMicrocredits);
  const multiplier = 10_000n + BigInt(Math.round(markupPercent * 100));
  const quantum = 10n ** BigInt(6 - decimalPlaces);
  const numerator = cost * multiplier;
  const divisor = 10_000n * quantum;
  // half-up：floor((2n + d) / 2d)，等价于「余数 ≥ 一半则进一」
  const units = (numerator * 2n + divisor) / (divisor * 2n);
  const sale = units * quantum;
  if (sale > MAX_PRICE_MICROCREDITS) return null;
  return Number(sale);
}

/** 微积分 → 输入框文本（去掉尾随 0，整数不带小数点） */
export function saleInputValue(microcredits: number): string {
  const value = BigInt(Math.max(0, Math.trunc(microcredits)));
  const whole = value / CREDIT_SCALE;
  const fraction = String(value % CREDIT_SCALE).padStart(6, '0');
  return `${whole}.${fraction}`.replace(/\.?0+$/, '');
}

/**
 * 输入框文本 → 微积分。
 *
 * 非法输入抛错（由调用方转成提示）：最多 6 位小数、非负。
 */
export function parseSaleInput(text: string): number {
  const trimmed = String(text ?? '').trim();
  if (!/^\d+(?:\.\d{0,6})?$/.test(trimmed)) {
    throw new Error('销售价须为非负数，最多保留 6 位小数');
  }
  const [whole, fraction = ''] = trimmed.split('.');
  const amount = Number(BigInt(whole) * CREDIT_SCALE + BigInt(fraction.padEnd(6, '0')));
  if (!Number.isSafeInteger(amount)) throw new Error('销售价超出有效范围');
  return amount;
}

/** 加价率展示：（售价 − 成本）÷ 成本；成本为 0 时无意义 */
export function formatMarkup(costMicrocredits: number | null, saleMicrocredits: number | null): string {
  if (costMicrocredits === null || saleMicrocredits === null) return '—';
  if (costMicrocredits === 0) return '—';
  const percent = ((saleMicrocredits - costMicrocredits) * 100) / costMicrocredits;
  return `${percent.toFixed(2)}%`;
}

/** 价格档的规格标签（用于表格里的「规格」列） */
export function tierSpecLabel(tier: ChannelModelPriceTierView): string {
  const selector = tier.selector ?? {};
  const parts: string[] = [];
  for (const [key, value] of Object.entries(selector)) {
    if (!value || value === '*') continue;
    parts.push(`${key}=${value}`);
  }
  if (tier.resolution && tier.resolution !== '*') parts.push(tier.resolution);
  if (tier.videoSeconds > 0) parts.push(`${tier.videoSeconds} 秒`);
  return parts.length > 0 ? parts.join(' · ') : '通配规格';
}

/** 调价表格的一行：一个模型的一个价格档的一个售价字段 */
export interface RepriceRow {
  /** 行唯一键：`tierId:字段` */
  key: string;
  modelId: string;
  modelKey: string;
  modelName: string;
  channelLabel: string;
  providerModelKey: string;
  tierId: string;
  tierVersion: number;
  specLabel: string;
  field: RepricePriceField;
  /** 成本价（微积分）；未配置时为 null */
  cost: number | null;
  /** 售价输入框文本 */
  sale: string;
  /** 该行是否被手动改过（改价后重算会覆盖，手动标记用于提示） */
  manual: boolean;
}

/** 构造初始行：只取「已启用 + 成本与售价都已配置」的价格档 */
export function buildRepriceRows(models: AdminChannelModelView[]): RepriceRow[] {
  const rows: RepriceRow[] = [];
  for (const model of models) {
    for (const tier of model.priceTiers) {
      if (!tier.enabled) continue;
      for (const field of repricePriceFields(model.capability, tier.billingMode)) {
        const cost = tier.costPricing?.configured ? tier.costPricing[field.key] ?? null : null;
        rows.push({
          key: `${tier.id}:${field.key}`,
          modelId: model.id,
          modelKey: model.modelKey,
          modelName: model.displayName || model.modelKey,
          channelLabel: model.channelLabel,
          providerModelKey: model.providerModelKey || model.modelKey,
          tierId: tier.id,
          tierVersion: tier.priceVersion,
          specLabel: tierSpecLabel(tier),
          field,
          cost,
          sale: tier.priceConfigured ? saleInputValue(tier[field.key]) : '',
          manual: false,
        });
      }
    }
  }
  return rows;
}

/** 未就绪的模型（缺成本价或售价未确认）——这些模型不能参与调价 */
export function repriceBlockingModels(models: AdminChannelModelView[]): AdminChannelModelView[] {
  return models.filter((model) => {
    const enabled = model.priceTiers.filter((tier) => tier.enabled);
    if (enabled.length === 0) return true;
    return enabled.some((tier) => !tier.priceConfigured || !tier.costPricing?.configured);
  });
}
