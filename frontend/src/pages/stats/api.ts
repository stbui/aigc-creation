/**
 * 数据中心页面的接口入口 —— 目录内文件的唯一外部接口来源。
 *
 * 约定: `stats/` 下的文件不从 `src/lib/api` 直接取东西, 一律经由本文件。
 */

/** 创作数据总览 */
export { statsApi } from '../../lib/api';
/** 缩略图地址换算（最近作品与常用能力共用） */
export { assetThumbUrl } from '../../lib/api';
