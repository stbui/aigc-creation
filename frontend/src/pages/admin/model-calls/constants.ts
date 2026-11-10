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
