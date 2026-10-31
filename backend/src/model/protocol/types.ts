/**
 * 插件清单类型定义 —— 与 `yingce.plugin/v2` 逐字段对齐。
 *
 * 移植自 open-ai-canvas `internal/protocol/types.go`。清单是插件与宿主之间
 * 唯一的公共契约：插件只声明「怎么拼请求、怎么读响应」，执行由宿主完成。
 * 因此这里的字段是**运行时投影**，不是插件代码的反射结果。
 *
 * 命名沿用上游 camlCase 的线上格式，TS 侧不做下划线转换 —— 插件包是
 * 外部产物，字段名一旦与参考实现分叉，110 个内置包全部要改。
 */

import type { ImageParameter } from '../domain/image-parameters';

/** 模型能力（与 `CapabilityPlugin.modality` 的取值域一致） */
export type ManifestCapability = 'text' | 'image' | 'video' | 'audio';

/** provider 业务形态；空值等同 generation */
export type ProviderKind = 'generation' | 'processing';

/** provider 可挂载的宿主表面 */
export type ManifestSurface = 'admin.system-channel' | 'user.custom-channel' | 'canvas' | 'creation' | 'agent';

/** 一次上游请求的声明 */
export interface ManifestOperation {
  method: string;
  path?: string;
  pathTemplate?: any;
  originPath?: boolean;
  contentType?: string;
  contentTypeTemplate?: any;
  headers?: Record<string, any>;
  query?: Record<string, any>;
  body?: any;
  /** multipart 文本字段 */
  fields?: Record<string, string>;
  /** multipart 文件字段 */
  files?: ManifestFilePart[];
}

/** 先上传素材、再引用上游素材 ID 的前置步骤 */
export interface ManifestUpload extends ManifestOperation {
  kinds: string[];
  id: any;
}

export interface ManifestFilePart {
  name: string;
  source: any;
  filename?: any;
  mimeType?: any;
}

/** 响应映射：状态、任务号、文本、媒体、用量、错误 */
export interface ManifestResponse {
  taskIdPaths?: string[];
  statusPaths?: string[];
  errorPaths?: string[];
  messagePaths?: string[];
  textPaths?: string[];
  reasoningPaths?: string[];
  resultUrlPaths?: string[];
  resultPaths?: string[];
  resultKind?: string;
  resultEphemeral?: boolean;
  /** create 直接返回二进制媒体（如 TTS 音频流） */
  binaryPayload?: boolean;
  /** create 返回由连续 JSON 对象组成的 chunked 音频流 */
  streamedJsonAudio?: boolean;
  taskId?: any;
  status?: any;
  message?: any;
  stage?: any;
  queueAhead?: any;
  text?: any;
  reasoning?: any;
  images?: any;
  videos?: any;
  audios?: any;
  usage?: any;
}

/** 工具调用型文本请求的响应形状 */
export interface ManifestAgentResponse {
  textPaths?: string[];
  reasoningPaths?: string[];
  toolCallsPath?: string;
  toolCallIdPaths?: string[];
  toolCallNamePaths?: string[];
  toolCallArgumentsPaths?: string[];
  toolCallThoughtSignaturePaths?: string[];
}

export interface ManifestAuth {
  type: string;
  field: string;
  secretField?: string;
  header?: string;
  prefix?: string;
  query?: string;
  username?: string;
  service?: string;
  region?: string;
}

export interface ManifestValidation {
  assert: any;
  message: string;
}

export interface ManifestParameter {
  name: string;
  type: string;
  required?: boolean;
  mapping?: string;
  description?: string;
  default?: any;
  enum?: any[];
  minimum?: number;
  maximum?: number;
}

/**
 * 图像参数合同：与运行时 `ImageParameter` **同一份类型**。
 * 早先这里是一份字段更少的副本（name/type/values/default），结果 builtin 执行器
 * 与插件执行器对同一份清单给出不同的校验结论 —— 名称、范围、binding、计价资格
 * 全部来自这里，不能有两份形状。
 */
export type ManifestImageParameter = ImageParameter;

export interface ManifestProvider {
  id: string;
  label: string;
  kind?: ProviderKind;
  capabilities: ManifestCapability[];
  scopes: ManifestSurface[];
  baseUrl?: string;
  requiresPublicMediaUrls?: boolean;
  detachedPolling?: boolean;
  idempotentCreate?: boolean;
  auth?: ManifestAuth;
  parameters?: ManifestParameter[];
  imageParameters?: ManifestImageParameter[];
  validations?: ManifestValidation[];
  create: ManifestOperation;
  upload?: ManifestUpload;
  agent?: ManifestOperation;
  poll?: ManifestOperation;
  cancel?: ManifestOperation;
  result?: ManifestOperation;
  response: ManifestResponse;
  agentResponse?: ManifestAgentResponse;
}

export interface ManifestField {
  name: string;
  type: string;
  label?: string;
  required?: boolean;
  secret?: boolean;
  default?: any;
  description?: string;
  values?: string[];
}

export interface ManifestConfiguration {
  fields?: ManifestField[];
}

export interface ManifestRuntime {
  backend?: string;
  backendEntry?: string;
  web?: string;
}

export interface ManifestSMSProvider {
  id: string;
  label: string;
}

export interface ManifestPaymentProvider {
  id: string;
  label: string;
  icon: string;
  checkoutMode: string;
  expiryPolicy: { defaultMinutes: number; minMinutes: number; maxMinutes: number };
  identityFields?: string[];
  notificationSuccess?: { status?: number; contentType?: string; body?: string };
  notificationFailure?: { status?: number; contentType?: string; body?: string };
}

export interface ManifestWorkflow {
  id: string;
  label: string;
  providerId: string;
  capability: ManifestCapability;
  parameters: ManifestParameter[];
  defaults?: Record<string, any>;
}

export interface ManifestCanvasNode {
  id: string;
  label: string;
  defaultTitle: string;
  defaultSize: Record<string, number>;
  schema: Record<string, any>;
  renderer: string;
}

export interface ManifestTransform {
  id: string;
  input: string;
  output: string;
  runtime: string;
}

export interface ManifestCommand {
  id: string;
  label: string;
}

export interface ManifestContributions {
  smsProviders?: ManifestSMSProvider[];
  providers?: ManifestProvider[];
  paymentProviders?: ManifestPaymentProvider[];
  workflows?: ManifestWorkflow[];
  canvasNodes?: ManifestCanvasNode[];
  transforms?: ManifestTransform[];
  commands?: ManifestCommand[];
  assetSources?: string[];
  usageObservers?: string[];
  aiCapabilities?: string[];
  agents?: string[];
  importExport?: string[];
}

/** 清单元数据（运行时投影，不参与序列化） */
export interface PluginMetadata {
  id: string;
  name: string;
  version: string;
  vendor: string;
  description: string;
  documentation: string;
  enabled: boolean;
  installable: boolean;
}

/** 完整清单 */
export interface Manifest {
  apiVersion: string;
  metadata: PluginMetadata;
  entry?: string;
  surfaces?: string[];
  runtime?: ManifestRuntime;
  permissions?: string[];
  configuration?: ManifestConfiguration;
  contributes: ManifestContributions;
  /** 以下为 `contributes.providers[]` 的规范化投影（单 provider 场景） */
  create?: ManifestOperation;
  upload?: ManifestUpload;
  agent?: ManifestOperation;
  poll?: ManifestOperation;
  cancel?: ManifestOperation;
  result?: ManifestOperation;
  response?: ManifestResponse;
  agentResponse?: ManifestAgentResponse;
  auth?: ManifestAuth;
  validations?: ManifestValidation[];
}

/** 清单版本常量 */
export const MANIFEST_API_VERSION = 'yingce.plugin/v2';

/** 插件包容器版本常量 */
export const PLUGIN_PACKAGE_VERSION = 'yingce.plugin/package-v1';

/** 允许的 provider 能力 */
export const MANIFEST_CAPABILITIES: readonly ManifestCapability[] = ['text', 'image', 'video', 'audio'];

/** 允许的宿主表面 */
export const MANIFEST_SURFACES: readonly ManifestSurface[] = [
  'admin.system-channel',
  'user.custom-channel',
  'canvas',
  'creation',
  'agent',
];
