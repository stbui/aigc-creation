/**
 * 存储配置的类型出口 —— 目录内文件的唯一类型来源。
 *
 * 外部类型（`types/api`）在此统一 re-export，业务文件一律从 `./types` 取；
 * 本目录派生的结构与展示结构也定义于此。新增引用时在这里补一行 re-export。
 */

import type { AdminAssetStats, AdminStorageStatus } from '../../../types/api';

export type {
  AdminAssetStats,
  AdminStorageStatus,
  StorageBackendId,
  StorageConfigField,
  StorageConfigView,
  AdminStorageSaveConfigResult,
} from '../../../types/api';

/** 单个存储后端的状态行（凭据、连通性、是否默认）。 */
export type StorageBackendRow = AdminStorageStatus['backends'][number];

/** 占比条的一行：按素材**条数**统计，不用字节反推。 */
export interface DistributionRow {
  key: string;
  label: string;
  count: number;
}

/** 页面一次取数的组合结果：缺少 asset.read 时 stats 为 null。 */
export interface StorageOverview {
  status: AdminStorageStatus;
  stats: AdminAssetStats | null;
}
