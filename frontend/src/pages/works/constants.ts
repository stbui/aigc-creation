/**
 * 我的作品页面的常量与共享类型 —— 目录内文件的唯一常量入口。
 *
 * 约定: `works/` 下的文件不从 `src/lib/constants` 直接取东西,
 * 一律经由本文件 —— 分页节奏、日期档位与状态档位集中可见。
 */

/** 日期筛选档位；`custom` 由日期输入框隐式切换，不出现在快捷项里 */
export type DatePreset = 'all' | 'today' | 'yesterday' | '7d' | 'custom';

/** 状态筛选档位；失败 / 取消任务不会进入列表，只剩「成功 / 生成中」 */
export type WorkStatus = 'succeeded' | 'running';

/** 首屏与「加载更多」每次追加的作品数 */
export const PAGE_SIZE = 24;

/** 服务端每页条数：大于首屏可见数，切换筛选时不必立刻再请求 */
export const SERVER_PAGE_SIZE = 50;

/** 日期筛选快捷项 */
export const DATE_PRESET_SHORTCUTS: ReadonlyArray<{
  value: Exclude<DatePreset, 'custom'>;
  label: string;
}> = [
  { value: 'all', label: '全部' },
  { value: 'today', label: '今天' },
  { value: 'yesterday', label: '昨天' },
  { value: '7d', label: '近 7 天' },
];

/** 状态筛选档位 */
export const WORK_STATUS_OPTIONS: ReadonlyArray<{ value: WorkStatus; label: string }> = [
  { value: 'succeeded', label: '成功' },
  { value: 'running', label: '生成中' },
];
