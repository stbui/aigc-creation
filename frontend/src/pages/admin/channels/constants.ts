import type { SelectFieldOption } from '~/admin-ui/primitives';
import { BILLING_MODE_LABELS } from '../../../lib/billing-mode';

/* ------------------------------------------------------------------------- */
/* 渠道                                                                      */
/* ------------------------------------------------------------------------- */

export interface ChannelHeader {
  name: string;
  value: string;
}

/**
 * 渠道新建 / 编辑表单的本地草稿。
 *
 * 凭证只在内存里，保存后不回读；`apiKey` / `secretKey` 留空表示「不修改」。
 */
/**
 * 供应商默认商品配置的本地草稿。
 *
 * 与单个商品的售价一样按「积分」输入、6 位小数；保存时换算成微积分。
 * `capability` 为空 = 不使用默认配置（导入只建骨架行）。
 */
export interface DefaultModelDraft {
  capability: string;
  protocol: string;
  billingMode: string;
  unit: string;
  input: string;
  output: string;
  cached: string;
  /** 套用到商品后是否直接启用 */
  enabled: boolean;
}

export const EMPTY_DEFAULT_MODEL_DRAFT: DefaultModelDraft = {
  capability: '',
  protocol: '',
  billingMode: 'fixed_request',
  unit: '',
  input: '',
  output: '',
  cached: '',
  enabled: true,
};

export interface ChannelDraft {
  name: string;
  baseUrl: string;
  apiKey: string;
  secretKey: string;
  proxyUrl: string;
  useGlobalConcurrency: boolean;
  concurrencyLimit: string;
  enabled: boolean;
  sortOrder: string;
  headers: ChannelHeader[];
  defaultModel: DefaultModelDraft;
}

export const EMPTY_CHANNEL_DRAFT: ChannelDraft = {
  name: '',
  baseUrl: '',
  apiKey: '',
  secretKey: '',
  proxyUrl: '',
  useGlobalConcurrency: true,
  concurrencyLimit: '8',
  enabled: true,
  sortOrder: '0',
  headers: [],
  defaultModel: { ...EMPTY_DEFAULT_MODEL_DRAFT },
};

/** 渠道级健康汇总：把该渠道下各线路的 24h 样本加总，左列一眼看出哪家在坏 */
export interface ChannelHealthSummary {
  samples: number;
  success: number;
}

/** 视图切换：`models` = 商品台账（默认），`channels` = 按供应商配置 */
export const CHANNEL_VIEW_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'models', label: '商品台账' },
  { value: 'channels', label: '供应商' },
];

export const CHANNEL_STATUS_OPTIONS: SelectFieldOption[] = [
  { value: 'enabled', label: '可用' },
  { value: 'disabled', label: '已停用' },
];

/* ------------------------------------------------------------------------- */
/* 渠道模型                                                                  */
/* ------------------------------------------------------------------------- */

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
  { value: 'enabled', label: '可用' },
  { value: 'disabled', label: '已停用' },
  { value: 'unpriced', label: '待定价' },
  { value: 'unconfigured', label: '待配置' },
];

export const PAGE_SIZE = 20;

/**
 * 上游导入时的统一配置。
 *
 * 只支持 image / text：这两种能力有可直接保存的默认合同；video / audio 的
 * 参数组合差异太大，批量写默认值会把半成品推进路由目录，宁可让运营逐条配。
 *
 * 能力合同由后端按**真实上游模型键**生成（插件参数可以限定适用模型），
 * 前端不再拼 JSON —— 否则同一份默认配置在不同模型上会少参数。
 */
export interface BatchImportConfig {
  capability: 'image' | 'text';
  protocol: string;
  billingMode: string;
  unitPriceMicrocredits: number;
  inputTokenPriceMicrocredits: number;
  outputTokenPriceMicrocredits: number;
  cachedTokenPriceMicrocredits: number;
  /** 导入后是否直接启用 */
  enabled: boolean;
}

/** 「商品台账」的状态筛选：比单供应商清单多「不健康」一档 */
export type AllModelsStatusFilter =
  | 'all'
  | 'enabled'
  | 'disabled'
  | 'unhealthy'
  | 'unpriced'
  | 'unconfigured'
  | 'cooling';

export const ALL_MODELS_STATUS_OPTIONS: Array<{ value: AllModelsStatusFilter; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'enabled', label: '可用' },
  { value: 'disabled', label: '已停用' },
  { value: 'unhealthy', label: '不健康' },
  { value: 'unpriced', label: '待定价' },
  { value: 'unconfigured', label: '待配置' },
  { value: 'cooling', label: '冷却中' },
];

/**
 * 经营筛选：与商品状态正交，答案来自近 7 天账单聚合。
 *
 * 状态回答「能不能卖」，经营筛选回答「卖得怎么样 / 哪里还没准备好」。
 * 同一个商品可以同时是「可用」与「无调用」。
 */
export type AllModelsCommerceFilter =
  | 'pending-pricing'
  | 'no-calls'
  | 'low-margin'
  | 'high-refund'
  | 'invalid-binding'
  | 'supplier-disabled';

export const ALL_MODELS_COMMERCE_OPTIONS: Array<{
  value: AllModelsCommerceFilter;
  label: string;
}> = [
  { value: 'pending-pricing', label: '待定价' },
  { value: 'no-calls', label: '无调用' },
  { value: 'low-margin', label: '低毛利' },
  { value: 'high-refund', label: '高退款' },
  { value: 'invalid-binding', label: '失效绑定' },
  { value: 'supplier-disabled', label: '供应商停用' },
];

/** 跨渠道清单每页条数：数据已全量在内存，页大一点少翻页 */
export const ALL_MODELS_PAGE_SIZE = 50;

/** 价格档的计费方式下拉：基准文案取 `lib/billing-mode.ts`，仅时长补单位 */
export const BILLING_MODE_OPTIONS = [
  { value: 'fixed_request', label: BILLING_MODE_LABELS.fixed_request },
  { value: 'per_second', label: `${BILLING_MODE_LABELS.per_second}（秒）` },
  { value: 'token', label: BILLING_MODE_LABELS.token },
];

export const CURRENCY_OPTIONS = [
  { value: 'credits', label: '积分' },
  { value: 'USD', label: '美元' },
  { value: 'CNY', label: '人民币' },
];

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
  /** C 端模型分组键；留空 = 使用商品编号 */
  modelGroupKey: string;
  providerModelKey: string;
  displayName: string;
  channelLabel: string;
  description: string;
  icon: string;
  capability: string;
  protocol: string;
  priceCurrency: string;
  /**
   * 展示标签（结构化）。
   *
   * 此前是「文字:颜色, 文字:颜色」的自由文本，运营容易写错颜色名
   * （非法颜色静默回落紫色），也无法看到最终效果。改为结构化数组后
   * 由标签编辑器渲染，颜色从固定 6 色里选。
   */
  tags: Array<{ text: string; color: string }>;
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

export const EMPTY_MODEL_DRAFT: ModelDraft = {
  modelKey: '',
  modelGroupKey: '',
  providerModelKey: '',
  displayName: '',
  channelLabel: '',
  description: '',
  icon: '',
  capability: 'image',
  protocol: '',
  priceCurrency: 'credits',
  tags: [],
  capabilityConfig: '',
  enabled: true,
  tiers: [{ ...EMPTY_TIER }],
};
