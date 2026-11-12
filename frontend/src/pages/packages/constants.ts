/**
 * 积分商城页面的常量 —— 目录内文件的唯一常量入口。
 */

export const PACKAGES_PAGE_META = {
  title: '积分商城 · 货觉AI',
  description: '购买积分包与会员套餐，解锁全部 AI 创作能力。',
} as const;

/** 积分包按有效期分组：31 天短期包与永久包是两种消费方式，混在一排里没法比较 */
export const PACK_FILTERS = [
  { key: 'all', label: '全部' },
  { key: 'short', label: '31 天有效' },
  { key: 'forever', label: '永久有效' },
] as const;

export type PackFilter = (typeof PACK_FILTERS)[number]['key'];

/** 各筛选项下的商品数（只展示真实存在的分类） */
export type PackCounts = Record<PackFilter, number>;
