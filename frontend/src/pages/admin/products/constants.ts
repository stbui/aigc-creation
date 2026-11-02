/**
 * 商品的表单草稿与下拉选项。
 *
 * 金额在表单里留字符串（避免每次输入都做一次有损转换），
 * 转换只在 `toDraft`（回填）与 `buildProductPayload`（提交）两处发生。
 */

export interface ProductDraft {
  sku: string;
  name: string;
  description: string;
  /** 元 */
  priceYuan: string;
  /** 元；空串 = 无划线价 */
  originalPriceYuan: string;
  credits: string;
  /** 0 = 永久 */
  creditsValidDays: string;
  grantType: 'immediate' | 'manual';
  sortOrder: string;
}

export const EMPTY_DRAFT: ProductDraft = {
  sku: '',
  name: '',
  description: '',
  priceYuan: '',
  originalPriceYuan: '',
  credits: '',
  creditsValidDays: '0',
  grantType: 'immediate',
  sortOrder: '0',
};

export const STATUS_OPTIONS = [
  { value: 'active', label: '在售' },
  { value: 'offline', label: '已下架' },
];

export const GRANT_TYPE_OPTIONS = [
  { value: 'immediate', label: '支付成功即发放' },
  { value: 'manual', label: '人工发放' },
];
