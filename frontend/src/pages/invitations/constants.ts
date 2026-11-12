/**
 * 邀请有奖页面的常量 —— 目录内文件的唯一常量入口。
 *
 * 约定: `invitations/` 下的文件不从 `src/lib/constants` 直接取东西,
 * 一律经由本文件 —— 奖励状态色板、分页步长与海报尺寸集中可见。
 */

import type { MyInvites } from '../../types/api';

/** 页面共用的接口类型 (仅类型, 无运行期依赖) */
export type { CheckinStatus, MyInvites } from '../../types/api';

/** 邀请记录的状态文案与色板: pending 不能被写成「已发放」 */
export const REWARD_STATUS: Record<
  MyInvites['relations'][number]['rewardStatus'],
  { label: string; className: string }
> = {
  granted: { label: '已发放', className: 'is-granted' },
  pending: { label: '待发放', className: 'is-pending' },
  rejected: { label: '未通过', className: 'is-rejected' },
};

/** 邀请记录每次加载的条数 */
export const RELATION_PAGE_SIZE = 20;

/** 邀请海报尺寸 (canvas 合成, 640×880 PNG) */
export const POSTER_WIDTH = 640;
export const POSTER_HEIGHT = 880;
