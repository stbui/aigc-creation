/**
 * 前台模型的静态文案与草稿类型。
 *
 * 价格策略 / 计费方式的取值必须与后端 `LogicalModel` 的字段口径一致；
 * 这里只负责界面文案与选项，真正的语义（统一价 vs 跟随渠道）在计费链路。
 */

export const PRICE_POLICY_OPTIONS = [
  { value: 'unified', label: '统一价（按本页价格计费）' },
  { value: 'channel', label: '跟随渠道（按渠道模型价格档）' },
];

export const BILLING_MODE_OPTIONS = [
  { value: 'fixed_request', label: '按次' },
  { value: 'per_second', label: '按时长（秒）' },
  { value: 'token', label: '按 Token 用量' },
];

export const PRICE_POLICY_LABELS: Record<string, string> = {
  unified: '统一价',
  channel: '跟随渠道',
};

export const BILLING_MODE_LABELS: Record<string, string> = {
  fixed_request: '按次',
  per_second: '按秒',
  token: '按 Token',
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
  enabled: true,
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

/** 能力合同里预置的示例，只在新建时作为占位提示，不写入草稿 */
export const CAPABILITY_SPEC_PLACEHOLDER =
  '{"version": 1, "capability": "image", "operations": ["generate"]}';
