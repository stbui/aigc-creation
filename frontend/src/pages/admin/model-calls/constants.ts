/**
 * AdminModelCallsPage 的本地常量与类型。
 */

export const REQUEST_KIND_LABELS: Record<string, string> = {
  create: '创建',
  poll: '轮询',
  task: '连通性测试',
  proxy: '中转',
};

export const SOURCE_LABELS: Record<string, string> = {
  task: '生成任务',
  tool: '提示词工具',
  admin: '后台测试',
  proxy: 'API 中转',
  gateway: '网关',
};

export const CAPABILITY_LABELS: Record<string, string> = {
  text: '文本',
  image: '图片',
  video: '视频',
  audio: '音频',
  multi_fusion: '多图融合',
};

export const OPERATION_LABELS: Record<string, string> = {
  image_to_prompt: 'AI 分析 / 图片转提示词',
  prompt_polish: '提示词润色',
  admin_model_test: '后台模型测试',
  image_to_image: '图生图',
  text_to_image: '文生图',
  proxy: 'API 中转',
};

export const STATUS_LABELS: Record<string, string> = {
  success: '成功',
  failed: '失败',
  canceled: '已取消',
};

export const STATUS_TONES: Record<string, 'success' | 'danger' | 'warn' | 'brand' | 'muted'> = {
  success: 'success',
  failed: 'danger',
  canceled: 'muted',
};

/**
 * 筛选下拉选项。提到模块级：内联字面量会让页面任一 state 变化（筛选、分页、
 * 轮询刷新）都重建数组，带着 5 个 SelectField 一起重渲染。
 */
type SelectOption = { value: string; label: string };

export const STATUS_OPTIONS: SelectOption[] = [
  { value: 'success', label: '成功' },
  { value: 'failed', label: '失败' },
  { value: 'canceled', label: '已取消' },
];

export const REQUEST_KIND_OPTIONS: SelectOption[] = [
  { value: 'create', label: '创建' },
  { value: 'poll', label: '轮询' },
  { value: 'task', label: '连通性测试' },
  { value: 'proxy', label: '中转' },
];

export const SOURCE_OPTIONS: SelectOption[] = [
  { value: 'tool', label: '提示词工具' },
  { value: 'task', label: '生成任务' },
  { value: 'admin', label: '后台测试' },
  { value: 'proxy', label: 'API 中转' },
  { value: 'gateway', label: '网关' },
];

export const OPERATION_OPTIONS: SelectOption[] = [
  { value: 'image_to_prompt', label: 'AI 分析 / 图片转提示词' },
  { value: 'prompt_polish', label: '提示词润色' },
  { value: 'image_to_image', label: '图生图' },
  { value: 'text_to_image', label: '文生图' },
  { value: 'admin_model_test', label: '后台模型测试' },
];

export const BILLABLE_OPTIONS: SelectOption[] = [
  { value: 'true', label: '计费' },
  { value: 'false', label: '不计费' },
];
