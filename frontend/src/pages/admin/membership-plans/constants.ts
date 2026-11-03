/**
 * 会员套餐的表单草稿。
 *
 * 金额与倍率在表单里都是字符串（避免每次输入都做有损转换），
 * 换算只在 `toDraft`（回填）与 `buildPlanPayload`（提交）两处发生。
 */

export interface PlanDraft {
  code: string;
  name: string;
  description: string;
  priceYuan: string;
  durationDays: string;
  monthlyCredits: string;
  fastChannel: boolean;
  /** 0 = 不限 */
  maxConcurrent: string;
  /** 100 = 无折扣 */
  discountPercent: string;
  sortOrder: string;
}

export const EMPTY_DRAFT: PlanDraft = {
  code: '',
  name: '',
  description: '',
  priceYuan: '',
  durationDays: '30',
  monthlyCredits: '0',
  fastChannel: true,
  maxConcurrent: '5',
  discountPercent: '100',
  sortOrder: '0',
};
