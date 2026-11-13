/**
 * 提示词预览 —— 一张图的最终提示词。
 *
 * 由后端按**能力自己的** `buildPrompt` / `outputPlan` 计算，
 * 前端不得复刻一份提示词模板（两份必然漂移，预览就失去意义了）。
 */

/** 一条提示词 */
export interface PromptPreviewItem {
  /** 批次内稳定键 */
  key: string;
  /** 展示名（变体名 / 模块名） */
  label: string;
  /** 最终发给模型的完整提示词 */
  prompt: string;
}

/** 提示词预览结果 */
export interface PromptPreviewResult {
  /** 能力标识 */
  capability: string;
  /** 能力展示名 */
  capabilityName: string;
  /** 收敛后的参数（与真实链路落库的参数一致） */
  params: Record<string, unknown>;
  /** 本次会产出的每一张图的提示词 */
  items: PromptPreviewItem[];
  /** 本次会产出的张数（与真实提交拆出的任务数一致） */
  outputCount: number;
}
