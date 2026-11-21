/**
 * 存储配置的接口入口 —— 目录内文件的唯一外部接口来源。
 *
 * `adminStorageApi` / `adminAssetsApi` 定义在 `lib/api-admin-assets`，由本页与
 * 素材管理页共用，这里只转出、不重复定义，避免两处契约分叉；业务文件一律从
 * `./api` 取用，调用形式保持 `adminStorageApi.xxx()` / `adminAssetsApi.xxx()`。
 * 需要新的后端接口时先在这里补齐转出或封装。
 */

export { adminAssetsApi, adminStorageApi } from '../../../lib/api';
