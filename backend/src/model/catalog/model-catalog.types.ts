/**
 * 上游模型目录合同（`GET {base}/models` 的归一化结果）。
 *
 * 移植自 open-ai-canvas `internal/app/channel_model_catalog.go`。这里是
 * **后台选型视图**的最小合同：只透出上游公开元数据，不猜能力、不展开
 * 「兼容模型」—— 那些要由管理员在渠道模型上显式声明协议与能力。
 */

export interface ChannelModelCatalogOption {
  value: string;
  label?: string;
}

export interface ChannelModelCatalogDefaultParameters {
  aspectRatio?: string;
  durationSeconds?: string;
  resolution?: string;
}

export interface ChannelModelCatalogOptions {
  aspectRatio?: ChannelModelCatalogOption[];
  durationSeconds?: ChannelModelCatalogOption[];
  resolution?: ChannelModelCatalogOption[];
}

export interface ChannelModelCatalogItem {
  id: string;
  displayName?: string;
  /** 'text' | 'image' | 'video' | 'audio'，无法识别时为空 */
  modelType?: string;
  supportedEndpointTypes?: string[];
  defaultParameters?: ChannelModelCatalogDefaultParameters;
  options?: ChannelModelCatalogOptions;
  supportsImages?: boolean;
  minImages?: number;
  maxImages?: number;
}

/** 拉取上游目录的入参（系统渠道只传已保存配置，不经过浏览器） */
export interface ChannelModelCatalogRequest {
  baseUrl: string;
  apiKey: string;
  apiFormat: string;
  headers?: Array<{ name: string; value: string }>;
  proxyUrl?: string | null;
  timeoutMs?: number;
}

/** 补充目录插件：只补标准 `/models` 没暴露的厂商模型 */
export interface ModelCatalogDiscovery {
  providerId: string;
  match(baseUrl: string, headers: Array<{ name: string; value: string }>): boolean;
  additionalModels(): ChannelModelCatalogItem[];
}

export interface ChannelModelFetchResult {
  /** 上游目录里的模型（含补充目录），已去重并排序 */
  models: ChannelModelCatalogItem[];
  /** 本次新写入、默认停用的渠道模型数量 */
  added: number;
}
