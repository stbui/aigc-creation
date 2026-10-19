/**
 * 能力标识。清单以后端 capability.registry 为准 (15 项), 前端不枚举 ——
 * 保留基础联合仅用于类型提示, 运行时以 CapabilityDef.id 为准。
 */
export type KnownCapability = 'main_image' | 'detail_image' | 'matting';
export type Capability = KnownCapability | (string & {});

/** 能力模式: real=本地真实算法 / mock=本地占位效果 / planned=尚未开放 */
export type CapabilityMode = 'real' | 'mock' | 'planned';
export type CapabilityGroupId = 'ecommerce_gen' | 'ai_retouch' | 'ai_video';
export type ParamType = 'enum' | 'number' | 'text' | 'boolean';

export interface ParamOption {
  value: string | number;
  label: string;
}

/** 参数声明: 工具页表单按此渲染, 新增能力无需改前端 */
export interface CapabilityParam {
  key: string;
  label: string;
  type: ParamType;
  default?: string | number | boolean;
  options?: ParamOption[];
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
  help?: string;
}

export interface CapabilityDef {
  id: string;
  name: string;
  group: CapabilityGroupId;
  summary: string;
  sidebarHint?: string;
  badge?: string;
  mode: CapabilityMode;
  inputs: 0 | 1 | 2;
  inWorkbench: boolean;
  help?: string;
  params: CapabilityParam[];
  defaultParams: Record<string, unknown>;
}

export interface CapabilityGroup {
  id: CapabilityGroupId;
  name: string;
  desc: string;
}

/** GET /api/v1/capabilities */
export interface CapabilitiesResponse {
  groups: CapabilityGroup[];
  items: CapabilityDef[];
  workbenchIds: string[];
}

/** GET /api/v1/stats/overview */
export interface StatsOverview {
  totals: {
    tasks: number;
    succeeded: number;
    failed: number;
    running: number;
    assets: number;
    originals: number;
    generated: number;
    projects: number;
    successRate: number | null;
  };
  byCapability: Array<{
    capability: string;
    name: string;
    mode: string;
    total: number;
    succeeded: number;
    /** 该能力最近一次成功产出, 用作工作台卡片示例图 */
    thumbnailUrl: string | null;
  }>;
  last7Days: Array<{ date: string; count: number }>;
  recentTasks: Array<{
    id: string;
    capability: string;
    name: string;
    status: string;
    createdAt: string;
    thumbnailUrl: string | null;
  }>;
}

export type TaskStatus = 'pending' | 'running' | 'succeeded' | 'failed';

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
  name?: string;
}

export interface UserProfile {
  id: string;
  email: string;
  name?: string;
}

export interface AuthResponse {
  accessToken: string;
  user?: UserProfile;
}

export interface Project {
  id: string;
  name: string;
  createdAt?: string;
}

// 与后端 Prisma Asset 模型对齐 (backend/prisma/schema.prisma)
// 后端 src/assets/assets.service.ts createOriginal 返回完整 Asset 记录,
// 注意字段是 sourceUrl 而非 url。
export interface Asset {
  id: string;
  projectId: string;
  ownerId: string;
  kind: 'original' | 'generated' | string;
  capability?: Capability | null;
  sourceUrl: string;
  width?: number | null;
  height?: number | null;
  format: string;
  sizeBytes: number;
  createdAt: string;
}

export type AssetUploadResponse = Asset;

/** GET /api/v1/assets — 素材库列表 */
export interface AssetListResult {
  items: Asset[];
  total: number;
  limit: number;
  offset: number;
}

export interface GenerateRequest {
  projectId: string;
  capability: Capability;
  inputAssetIds: string[];
  params: Record<string, unknown>;
}

export interface GenerateResponse {
  taskId: string;
  id?: string;
}

// 后端 getTask 返回 outputAsset (backend/src/generate/generate.service.ts:125),
// listTasks 不返回 outputAsset。错误码字段是 errorCode 而非 error。
export interface Task {
  id: string;
  projectId: string;
  capability: Capability;
  status: TaskStatus;
  inputAssetIds?: string[];
  params?: Record<string, unknown>;
  provider?: string | null;
  errorCode?: string | null;
  createdAt?: string;
  updatedAt?: string;
  outputAsset?: Pick<
    Asset,
    'id' | 'sourceUrl' | 'capability' | 'width' | 'height' | 'format'
  > | null;
}

export type TaskListResult = Task[];
