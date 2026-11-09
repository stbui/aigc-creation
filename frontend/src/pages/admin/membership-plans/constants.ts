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
  /**
   * 会员等级映射的用户分组编码；空串 = 落 `default` 分组。
   *
   * 分组决定该等级用户可见的渠道与价格倍率。不配则所有等级都落默认组，
   * 分组倍率与模型级覆盖形同虚设 —— 这是必须显式选的一项。
   */
  userGroupCode: string;
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
  userGroupCode: '',
};
