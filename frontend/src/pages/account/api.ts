/**
 * 账户中心页面的后端接口面 —— 目录内文件的唯一 API 入口。
 *
 * 接线: 资料 / 积分 / 会员 / 消息 / 工单 / 订单六个接口并行拉取，
 * 其中资料是主数据（失败即报错），其余附加信息用 `allSettled` 互不阻断。
 *
 * 约定: `account/` 下的文件不从 `lib/api` 直接取东西, 一律经由本文件转出 ——
 * 一个页面的后端依赖集中可见, 换实现只改一处。
 * 目录内新增调用时在这里补一行 re-export。
 */

/** 资料 / 积分 / 会员 / 消息 / 订单 / 工单 */
export {
  creditsApi,
  membershipApi,
  meApi,
  notificationsApi,
  ordersApi,
  ticketsApi,
} from '../../lib/api';
