/**
 * 我的作品页面的常量与共享类型 —— 目录内文件的唯一常量入口。
 *
 * 约定: `works/` 下的文件不从 `src/lib/constants` 直接取东西,
 * 一律经由本文件 —— 分页节奏与日期筛选档位集中可见。
 */

/** 参考站日期筛选的快捷项（本地按真实日期区间过滤） */
export type DatePreset = 'all' | 'today' | 'yesterday' | '7d' | 'custom';

/** 首屏与「加载更多」每次追加的作品数 */
export const PAGE_SIZE = 24;

/** 服务端每页条数：大于首屏可见数，切换筛选时不必立刻再请求 */
export const SERVER_PAGE_SIZE = 50;
