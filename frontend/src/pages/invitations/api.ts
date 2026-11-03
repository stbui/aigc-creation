/**
 * 邀请有奖页面的后端接口面 —— 目录内文件的唯一 API 入口。
 *
 * 约定: `invitations/` 下的文件不从 `lib/api` 直接取东西, 一律经由本文件转出。
 */

/** 邀请码 / 邀请关系 / 签到 / 绑定邀请码 */
export { myMarketingApi } from '../../lib/api';
