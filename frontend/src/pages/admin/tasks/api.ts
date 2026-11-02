/**
 * 任务监控的接口入口 —— 目录内文件的唯一外部接口来源。
 *
 * 约定：`tasks/` 下的文件不从 `src/lib/api` 直接取东西，一律经由本文件。
 */

export { adminTasksApi, assetThumbUrl, toAbsoluteUrl } from '../../../lib/api';
