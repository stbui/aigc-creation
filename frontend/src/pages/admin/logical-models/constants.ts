/**
 * 前台模型的静态文案与草稿类型。
 *
 * 价格策略 / 计费方式的取值必须与后端 `LogicalModel` 的字段口径一致；
 * 这里只负责界面文案与选项，真正的语义（统一价 vs 跟随渠道）在计费链路。
 */

export const PRICE_POLICY_OPTIONS = [
  { value: 'unified', label: '固定售价' },
  { value: 'channel', label: '跟随商品售价' },
];

/** 计费方式文案与下拉：唯一事实源在 `lib/billing-mode.ts`，此处仅转出。 */
export { BILLING_MODE_LABELS, BILLING_MODE_OPTIONS } from '../../../lib/billing-mode';

export const PRICE_POLICY_LABELS: Record<string, string> = {
  unified: '固定售价',
  channel: '跟随商品售价',
};

/** 表单里的单条线路草稿；`key` 只用于 React 列表定位，不提交后端 */
export interface RouteDraft {
  key: string;
  channelModelId: string;
  enabled: boolean;
  priority: string;
  weight: string;
}

/** 全量提交的模型草稿：金额统一用「积分」字符串，提交前再换算 */
export interface ModelDraft {
  code: string;
  name: string;
  icon: string;
  description: string;
  capability: string;
  sortOrder: string;
  enabled: boolean;
  pricePolicy: string;
  billingMode: string;
  unitPrice: string;
  inputPrice: string;
  outputPrice: string;
  cachedPrice: string;
  capabilitySpecText: string;
  defaultOptionsText: string;
  routes: RouteDraft[];
}

export const EMPTY_DRAFT: ModelDraft = {
  code: '',
  name: '',
  icon: '',
  description: '',
  capability: '',
  sortOrder: '0',
  enabled: false,
  pricePolicy: 'channel',
  billingMode: 'fixed_request',
  unitPrice: '0',
  inputPrice: '0',
  outputPrice: '0',
  cachedPrice: '0',
  capabilitySpecText: '',
  defaultOptionsText: '{}',
  routes: [],
};
