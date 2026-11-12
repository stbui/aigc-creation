/**
 * 积分明细页面的接口入口 —— 目录内文件的唯一外部接口来源。
 *
 * 约定: `credits/` 下的文件不从 `src/lib/api` 直接取东西, 一律经由本文件。
 */

/** 余额 / 流水 / 批次 */
export { creditsApi } from '../../lib/api';
