/**
 * 协议运行时契约 —— 插件与宿主之间唯一的执行接口。
 *
 * 移植自 open-ai-canvas `internal/protocol/types.go` 与 `adapter.go`。适配器只做
 * 「协议翻译」（拼请求、读响应），凭证、出站安全、轮询租约、计费、结果下载与
 * 任务恢复全部由宿主负责；这条边界是声明式插件可以安全执行的前提 ——
 * 插件永远拿不到数据库连接，也不直接发网络请求。
 *
 * 上游 Go 用 interface{} 表达所有模板值，这里统一用 `any`；`Buffer | string`
 * 的响应体允许适配器处理二进制结果（音频 / TTS 流）。
 */

import type { ManifestAuth, ManifestCapability, ManifestSurface, ProviderKind } from './types';
import type { ImageParameter } from '../domain/image-parameters';

/** 上游任务状态；`processing` 与 `pending` 都属于「还没出结果」 */
export type ProtocolStatus = 'pending' | 'processing' | 'succeeded' | 'failed' | 'cancelled';

/** 参考素材：宿主已下载 / 已上传后的统一表示 */
export interface MediaReference {
  id?: string;
  url?: string;
  /** `data:<mime>;base64,...`；与 url 二选一 */
  dataUrl?: string;
  kind?: string;
  role?: string;
  mimeType?: string;
  name?: string;
  order?: number;
  weight?: number;
  metadata?: Record<string, any>;
  /** 临时地址：宿主必须在任务结束前下载持久化 */
  ephemeral?: boolean;
}

/** 产出合同（新版）；旧版顶层字段仍保留在 GenerationRequest 上 */
export interface OutputOptions {
  count?: number;
  duration?: number;
  aspectRatio?: string;
  width?: number;
  height?: number;
  resolution?: string;
  quality?: string;
  fps?: number;
  generateAudio?: boolean;
  watermark?: boolean;
  format?: string;
  options?: Record<string, any>;
}

export interface GenerationMessage {
  role: string;
  content: any;
}

/**
 * 平台统一的生成请求。画布、创作站、智能体共用这一个契约，
 * 厂商特有参数只能放进 `providerOptions` / `extra`，宿主不解释它们。
 */
export interface GenerationRequest {
  capability?: ManifestCapability;
  model: string;
  prompt?: string;
  /** 系统指令；声明式协议会把它注入 messages 的 system 角色 */
  instructions?: string;
  messages?: GenerationMessage[];
  inputs?: MediaReference[];
  images?: MediaReference[];
  videos?: MediaReference[];
  audios?: MediaReference[];
  duration?: number;
  aspectRatio?: string;
  resolution?: string;
  quality?: string;
  generateAudio?: boolean;
  watermark?: boolean;
  imageCount?: number;
  operation?: string;
  output?: OutputOptions;
  /** 按协议命名空间隔离的厂商参数：`{ [protocolId]: { ... } }` */
  providerOptions?: Record<string, Record<string, any>>;
  /** 后台声明的图片参数当前取值（名称 → 值），由 ApplyImageParameters 投影 */
  imageParameters?: Record<string, any>;
  extra?: Record<string, any>;
}

/** create 上下文 */
export interface ProtocolRequestContext {
  baseUrl: string;
  request: GenerationRequest;
}

/** poll / cancel / result 上下文 */
export interface ProtocolPollContext {
  baseUrl: string;
  model: string;
  request: GenerationRequest;
  taskId: string;
  metadata?: Record<string, any>;
}

/** multipart 文件字段：具体字节由宿主在发送阶段按 reference 解析 */
export interface ProtocolRequestFilePart {
  name: string;
  filename?: string;
  mimeType?: string;
  reference: MediaReference;
}

/** 一次待发送的上游请求 */
export interface ProtocolRequestSpec {
  method: string;
  path: string;
  /** 为 true 时路径相对渠道基址的 origin（不带基址路径前缀） */
  originPath?: boolean;
  contentType: string;
  headers?: Record<string, string>;
  query?: Record<string, string[]>;
  body?: any;
  files?: ProtocolRequestFilePart[];
  /** 凭证注入方式；宿主发送时按它写入头 / 查询参数 */
  auth?: ManifestAuth;
}

/** 一次调用的产出 */
export interface ProtocolResult {
  images?: MediaReference[];
  videos?: MediaReference[];
  audios?: MediaReference[];
  text?: string;
  reasoning?: string;
  usage?: Record<string, any>;
}

export interface ProtocolCreateResult {
  taskId?: string;
  status: ProtocolStatus;
  result?: ProtocolResult | null;
  message?: string;
  /** 上游可读阶段（如「候车 · 前面 3 条」），仅用于展示 */
  stage?: string;
  /** 排在前面还有多少条；-1 = 上游未给出 */
  queueAhead?: number;
}

export interface ProtocolPollResult {
  taskId?: string;
  status: ProtocolStatus;
  result?: ProtocolResult | null;
  message?: string;
  stage?: string;
  queueAhead?: number;
}

/* ─────────────── 可选的 agent（工具调用）面 ─────────────── */

export interface ProtocolAgentRequestContext {
  baseUrl: string;
  model: string;
  request: Record<string, any>;
}

export interface ProtocolAgentToolCall {
  id: string;
  name: string;
  /** 参数始终是 JSON 文本，与平台工具体契约一致 */
  arguments: string;
  thoughtSignature: string;
}

export interface ProtocolAgentResult {
  text: string;
  reasoning: string;
  toolCalls: ProtocolAgentToolCall[];
}

/* ─────────────── 元数据（后台展示与保存校验读它） ─────────────── */

export interface ProtocolMetadata {
  id: string;
  /** 后台展示名（清单 provider.label） */
  label: string;
  /** 插件名（清单 metadata.name）；内置协议等于 label */
  name: string;
  version: string;
  vendor: string;
  description: string;
  documentation: string;
  capabilities: ManifestCapability[];
  scopes: ManifestSurface[];
  kind: ProviderKind;
  /** 是否支持异步轮询 */
  async: boolean;
  /** 是否支持前置素材上传 */
  upload: boolean;
  /** 是否需要渠道同时配置 Secret Key（AWS SigV4 / 火山 v4 / 腾讯 TC3） */
  requiresSecretKey: boolean;
  /** 图片参数合同（渠道模型的默认能力配置来源） */
  imageParameters?: ImageParameter[];
  /** create / poll / cancel 的操作摘要，用于后台列表 */
  create?: string;
  poll?: string;
  cancel?: string;
  contentType: string;
  requiresPublicMediaUrls: boolean;
  detachedPolling: boolean;
  idempotentCreate: boolean;
  /** 来源：内置 / 插件包 */
  source: 'builtin' | 'plugin';
  /** 所属插件 ID（内置协议为 `builtin`） */
  pluginId?: string;
  /** 不可用原因（host:<name> 后端未注册时由装配期写入） */
  unavailableReason?: string;
}

/**
 * 适配器契约。
 *
 * 可选方法必须显式声明「不支持」，宿主不会替它兜底 —— 静默降级成另一种请求
 * 只会把「协议没实现」变成「任务莫名失败」。
 */
export interface ProtocolAdapter {
  readonly metadata: ProtocolMetadata;
  buildCreate(context: ProtocolRequestContext): Promise<ProtocolRequestSpec> | ProtocolRequestSpec;
  /** `request` 提供给需要读请求上下文（如音频格式、幂等键）的响应映射 */
  parseCreate(body: Buffer | string, request?: GenerationRequest): Promise<ProtocolCreateResult> | ProtocolCreateResult;
  buildPoll?(context: ProtocolPollContext): Promise<ProtocolRequestSpec> | ProtocolRequestSpec;
  parsePoll?(context: ProtocolPollContext, body: Buffer | string): Promise<ProtocolPollResult> | ProtocolPollResult;
  buildCancel?(context: ProtocolPollContext): Promise<ProtocolRequestSpec> | ProtocolRequestSpec;
  /** 异步成功但没有公共媒体地址时，凭授权下载二进制结果 */
  buildResult?(context: ProtocolPollContext): Promise<ProtocolRequestSpec> | ProtocolRequestSpec;
  /** 前置素材上传（先上传拿 ID，create 再按 ID 引用） */
  buildUpload?(context: ProtocolRequestContext, media: MediaReference): Promise<ProtocolRequestSpec> | ProtocolRequestSpec;
  parseUpload?(body: Buffer | string): Promise<string> | string;
  buildAgent?(context: ProtocolAgentRequestContext): Promise<ProtocolRequestSpec> | ProtocolRequestSpec;
  parseAgent?(body: Buffer | string): Promise<ProtocolAgentResult> | ProtocolAgentResult;
}
