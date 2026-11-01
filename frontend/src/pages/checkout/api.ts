/**
 * 结算页的后端接口面 —— 目录内文件的唯一 API 入口。
 *
 * 接线: 商品 / 会员套餐 → 建单 → 发起支付 (沙箱 / 跳转 / 二维码) → 轮询到账。
 * `quote` (结算试算) 属于 C 端接口, 挂在 `myMarketingApi` 上;
 * `marketingApi` 是后台优惠券管理, 两者不要混用。
 *
 * 约定: `checkout/` 下的文件不从 `lib/api` 直接取东西, 一律经由本文件转出 ——
 * 一个页面的后端依赖集中可见, 换实现只改一处。
 * 目录内新增调用时在这里补一行 re-export。
 */

/** 接口错误 (试算失败按 status 区分券不可用 / 服务异常) */
export { ApiError } from '../../lib/api';

/** 商品 / 订单 / 积分 / 会员 / 支付 / 我的营销 (试算) */
export {
  creditsApi,
  membershipApi,
  myMarketingApi,
  ordersApi,
  paymentsApi,
  productsApi,
} from '../../lib/api';
