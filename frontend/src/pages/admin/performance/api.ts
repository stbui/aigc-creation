/**
 * 系统信息模块的接口入口 —— 目录内文件的唯一外部接口来源。
 *
 * `adminSystemPerformanceApi` 定义在 `lib/api-admin-settings`、经 `lib/api` 统一转出，
 * 这里只转出、不重复定义，避免两处契约分叉。
 */

export { adminSystemPerformanceApi } from '../../../lib/api';
