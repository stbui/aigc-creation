/**
 * 我的作品页面的后端接口面 —— 目录内文件的唯一 API 入口。
 *
 * 约定: `works/` 下的文件不从 `lib/api` / `lib/models` 直接取东西,
 * 一律经由本文件转出。
 */

/** 任务列表 / 删除 / 重试建单 / 幂等键 */
export { generateApi, newIdempotencyKey } from '../../lib/api';
/** 产出地址换算 (原图 / 缩略图) */
export { assetSrc, assetThumbSrc } from '../../lib/api';
/** 重试时解析原任务模型 */
export { resolveModelId } from '../../lib/models';
