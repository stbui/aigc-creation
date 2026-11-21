/**
 * 后台运维域类型的聚合出口。
 *
 * 具体定义按域拆在 admin-tasks / admin-maintenance / admin-storage /
 * admin-marketing；`types/api.d.ts` 与调用方仍然从 `./admin-ops` 取件，
 * 导入路径不变，新增类型只改对应的域文件。
 */

export type {
  AdminAssetGeneration,
  AdminAssetListResult,
  AdminAssetStats,
  AdminProject,
  AdminProjectListResult,
  AssetStatus,
  StorageBackendId,
} from "./admin-assets";

export type {
  AdminTask,
  AdminTaskCongestion,
  AdminTaskListResult,
  AdminTaskDetail,
} from "./admin-tasks";

export type {
  AdminBackup,
  AdminBackupStats,
  AdminCleanupLog,
  AdminSchedulerTask,
  AdminSchedulerStatus,
} from "./admin-maintenance";

export type {
  StorageConfigField,
  StorageConfigView,
  AdminStorageStatus,
  AdminStorageSaveConfigResult,
  AdminStorageProbeResult,
} from "./admin-storage";

export type {
  CouponType,
  CouponScope,
  CouponStatus,
  CampaignType,
  CampaignStatus,
  AdminCoupon,
  UpsertCouponPayload,
  AdminCampaign,
  UpsertCampaignPayload,
  AdminInviteListResult,
  AdminCheckinListResult,
  InviteRule,
  CheckinRule,
  MyInvites,
  CheckinStatus,
  MarketingQuote,
  PopupCampaign,
  PromoCampaign,
} from "./admin-marketing";

export type { AdminSystemPerformance } from "./admin-performance";
