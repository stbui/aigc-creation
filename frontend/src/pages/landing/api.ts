/**
 * 营销首页的接口入口 —— 目录内文件的唯一外部接口来源。
 *
 * 约定: `landing/` 下的文件不从 `src/lib/api` 直接取东西, 一律经由本文件。
 */

/** 商品 (积分包) */
export { productsApi } from '../../lib/api';
/** 订阅套餐 */
export { membershipApi } from '../../lib/api';
/** 营销活动 (限时活动) */
export { myMarketingApi } from '../../lib/api';
