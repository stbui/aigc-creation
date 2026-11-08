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

/**
 * 新建商品的默认排序权重。
 *
 * 取 100 而不是 0: 排序值「小的靠前」, 新商品默认插到现有商品之后,
 * 而不是和排在最前的老商品挤在同一档里。要置顶就在表单里改小。
 * 与后端 `commerce-admin.service.ts` 的 `PRODUCT_DEFAULT_SORT_ORDER` 同值。
 */
export const DEFAULT_SORT_ORDER = '100';

export const EMPTY_DRAFT: ProductDraft = {
  sku: '',
  name: '',
  description: '',
  priceYuan: '',
  originalPriceYuan: '',
  credits: '',
  creditsValidDays: '0',
  grantType: 'immediate',
  sortOrder: DEFAULT_SORT_ORDER,
};

/** 商品状态文案：表格、筛选 chip 与下拉共用一份 */
export const STATUS_LABELS: Record<'active' | 'offline', string> = {
  active: '在售',
  offline: '已下架',
};

export const STATUS_OPTIONS = [
  { value: 'active', label: '在售' },
  { value: 'offline', label: '已下架' },
];

/** 发放方式短文案：列表与 chip 用短口径，表单下拉再用完整说明 */
export const GRANT_TYPE_LABELS: Record<'immediate' | 'manual', string> = {
  immediate: '支付即发放',
  manual: '人工发放',
};

export const GRANT_TYPE_OPTIONS = [
  { value: 'immediate', label: '支付成功即发放' },
  { value: 'manual', label: '人工发放' },
];

/** 筛选下拉用短口径，与 chip / 列表文案一致 */
export const GRANT_TYPE_FILTER_OPTIONS = [
  { value: 'immediate', label: '支付即发放' },
  { value: 'manual', label: '人工发放' },
];
