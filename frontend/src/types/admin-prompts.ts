/** 提示词适用模态，与后端 `common/modality.ts` 同口径。 */
export type PromptModality = 'image' | 'video' | 'text';

/**
 * 提示词配图。
 *
 * `ref` 是稳定引用（`storage://<backend>/<key>` / `/templates/...` / http 地址），
 * 保存时只提交它；`previewUrl` 是读取时解析出的可访问地址，**不参与提交**。
 */
export interface PromptImage {
  ref: string;
  /** 从素材库选取时记录源素材 id，便于追溯 */
  assetId?: string;
  /** 原始文件名 / 素材名，仅展示用 */
  name?: string;
  /** 当前可访问的预览地址；解析失败为空串 */
  previewUrl?: string;
}

/** 后台提示词库条目。 */
export interface AdminPrompt {
  id: string;
  /** 可留空；为空时列表用正文摘要辨认 */
  title: string;
  category: string;
  content: string;
  negativePrompt: string;
  modality: PromptModality;
  tags: string[];
  images: PromptImage[];
  sortOrder: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

/** GET /api/v1/admin/prompts */
export interface AdminPromptListResult {
  items: AdminPrompt[];
  total: number;
  page: number;
  pageSize: number;
  /** 全量已有分类，供筛选下拉使用（不受当前筛选影响） */
  categories: string[];
}

/** POST /api/v1/admin/prompts/upload 的返回项。 */
export interface PromptUploadedImage {
  ref: string;
  previewUrl: string;
  width: number;
  height: number;
  sizeBytes: number;
  name: string;
}

/** 新建提示词。 */
export interface CreatePromptPayload {
  /** 可留空 */
  title?: string;
  category?: string;
  content: string;
  negativePrompt?: string;
  modality?: PromptModality;
  tags?: string[];
  images?: Array<Pick<PromptImage, 'ref' | 'assetId' | 'name'>>;
  sortOrder?: number;
  enabled?: boolean;
}

/** 编辑提示词。字段均可选，只提交改动项。 */
export type UpdatePromptPayload = Partial<CreatePromptPayload>;
