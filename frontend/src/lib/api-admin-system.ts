/**
 * 后台系统域的聚合出口。
 *
 * 实现按职责拆分在同目录：`api-admin-users`（账户与角色）、`api-admin-settings`
 * （设置 / 性能快照 / AIGC 角标）、`api-admin-catalog`（写真模板与提示词）、
 * `api-admin-operations`（任务监控与备份）、`api-admin-assets`（素材、项目与存储）。
 * `lib/api` 只从这里整体转出，页面侧的取用方式与拆分前一致。
 */
export { adminRolesApi, adminUsersApi } from "./api-admin-users";
export { adminAigcLabelApi, adminSettingsApi, adminSystemPerformanceApi } from "./api-admin-settings";
export { adminPromptsApi, adminTemplateCatalogApi } from "./api-admin-catalog";
export { adminBackupsApi, adminTasksApi } from "./api-admin-operations";
export { adminAssetsApi, adminStorageApi } from "./api-admin-assets";
