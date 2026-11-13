/**
 * 素材管理 + 存储后端接口类型 (admin-prd.md §3.4 B-21~27 / §3.11 B-62/63)。
 *
 * 从 `admin-ops.ts` 按域拆出：素材列表的返回体在加入生成信息后已足够大，
 * 继续堆在聚合文件里只会让体积守卫反复拦截。`admin-ops.ts` 仍原样再导出，
 * 调用方继续从 `types/api` 取件即可。
 */

import type { Project } from "./api";

/** 存储后端标识 */
export type StorageBackendId = "local" | "oss" | "minio";

/** 素材上架状态。hidden = 已下架, 用户端不可见但记录与文件保留 */
export type AssetStatus = "visible" | "hidden";

/**
 * 生成图的溯源信息，由产出它的 `GenerationTask` 快照重建。
 *
 * 原始上传没有产出任务，恒为 `null`。
 */
export interface AdminAssetGeneration {
  /** 产出该素材的任务 id，便于继续排查全链路 */
  taskId: string;
  /** 实际线路展示名（渠道模型 displayName → modelKey） */
  modelName: string;
  /** C 端模型分组键 */
  modelKey: string | null;
  /** 实际下发给模型的提示词 */
  prompt: string;
  /** 画面比例的展示名，能力无该参数时为 null */
  ratio: string | null;
  /** 输出画质的展示名，能力无该参数时为 null */
  quality: string | null;
}

/** GET /api/v1/admin/assets */
export interface AdminAssetListResult {
  items: Array<{
    id: string;
    kind: "original" | "generated";
    capability: string | null;
    width: number | null;
    height: number | null;
    format: string;
    sizeBytes: number;
    status: AssetStatus;
    /** 可访问 URL。本地为 /uploads/key, 云端为签名 URL(会过期, 不入库) */
    sourceUrl: string;
    /** 写入时的后端 —— 切换默认后端后老素材仍从这里读 */
    storageBackend: StorageBackendId;
    /** 存储内相对 key, 唯一真相, 不含域名 */
    storageKey: string | null;
    ownerId: string;
    ownerEmail: string;
    projectId: string;
    projectName: string;
    createdAt: string;
    generation: AdminAssetGeneration | null;
  }>;
  total: number;
  page: number;
  pageSize: number;
}

/** GET /api/v1/admin/assets/stats */
export interface AdminAssetStats {
  total: number;
  totalBytes: number;
  totalMb: number;
  byStatus: Record<string, number>;
  byBackend: Record<string, number>;
  byKind: Record<string, number>;
}

/** GET /api/v1/admin/projects */
export interface AdminProjectListResult {
  items: AdminProject[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AdminProject extends Project {
  ownerEmail: string;
  ownerName: string;
  assetCount: number;
  taskCount: number;
}
