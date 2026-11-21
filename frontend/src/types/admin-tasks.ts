/** 后台任务域：列表行、拥堵指标、详情与线路尝试。 */
import type { AdminTaskRouteAttempt } from "./task-route";

/** 列表行。字段与后端 tasks-admin.service list() 返回一一对应 */
export interface AdminTask {
  id: string;
  capability: string;
  capabilityName: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  errorCode: string | null;
  creditCost: number;
  /** 由哪个失败任务重试而来 (null = 用户首次发起) */
  retriedFromId: string | null;
  user: { id: string; email: string };
  project: { id: string; name: string };
  /** updatedAt - createdAt; running 任务的该值仍在增长 */
  durationMs: number;
  createdAt: string;
  updatedAt: string;
  thumbnailUrl: string | null;
}

/** 拥堵指标。刻意不受列表筛选影响 —— 它的用途是回答"系统现在堵不堵" */
export interface AdminTaskCongestion {
  queued: number;
  running: number;
  failedLastHour: number;
  runningThreshold: number;
}

export interface AdminTaskListResult {
  result: {
    items: AdminTask[];
    total: number;
    page: number;
    pageSize: number;
  };
  congestion: AdminTaskCongestion;
  capabilities: Array<{ capability: string; count: number }>;
  /** 近 24 小时失败任务按错误码聚合，用于「同因」快捷筛选 */
  failureGroups: Array<{ errorCode: string; count: number }>;
}

/** 任务详情 */
export interface AdminTaskDetail {
  id: string;
  capability: string;
  capabilityName: string;
  status: AdminTask["status"];
  errorCode: string | null;
  creditCost: number;
  retriedFromId: string | null;
  user: { id: string; email: string };
  project: { id: string; name: string };
  durationMs: number;
  createdAt: string;
  updatedAt: string;
  /** 状态流转节点；at=null 表示后端无可靠时间，不编造中间节点。 */
  timeline: Array<{
    key: string;
    label: string;
    at: string | null;
    done: boolean;
  }>;
  params: Record<string, unknown>;
  /** 线路尝试；旧版后端响应可能缺失此字段，前端按空数组兼容 */
  routeAttempts?: AdminTaskRouteAttempt[];
  /** 输入素材, 已按 inputAssetIds 原序排列 (多图能力依赖顺序语义) */
  inputAssets: Array<{
    id: string;
    sourceUrl: string;
    width: number | null;
    height: number | null;
    kind: string;
  }>;
  outputAsset: {
    id: string;
    sourceUrl: string;
    width: number | null;
    height: number | null;
    format: string;
    sizeBytes: number;
  } | null;
}
