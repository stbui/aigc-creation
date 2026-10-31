/**
 * 插件清单解码、校验与规范化。
 *
 * 移植自 open-ai-canvas `internal/protocol/manifest.go`。校验顺序与规则
 * 逐条对齐，因为 110 个内置插件包都是按这套规则产出的：放宽任何一条都会
 * 让「能安装但运行时才炸」的清单进入库内，收紧任何一条都会让存量包失效。
 *
 * 一个插件包可以声明多个 provider（多协议族共享一份配置），每个 provider
 * 是独立的运行时执行项；`normalizeManifest` 把单个 provider 投影到清单顶层，
 * 供执行器直接读取（参考实现同样如此，只是 Go 用指针字段表达）。
 */

import {
  MANIFEST_API_VERSION,
  MANIFEST_CAPABILITIES,
  MANIFEST_SURFACES,
  type Manifest,
  type ManifestOperation,
  type ManifestProvider,
  type ProviderKind,
} from './types';
import { ModelDomainError } from '../domain/json';
import { validateImageParameters as validateImageParameterContract } from '../domain/image-parameters';

/** 清单校验失败 */
export class ManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ManifestError';
  }
}

const ALLOWED_API_VERSIONS = ['yingce.plugin/v1', MANIFEST_API_VERSION];
const ALLOWED_METHODS = ['GET', 'POST', 'DELETE', 'PUT'];
const ALLOWED_CONTENT_TYPES = [
  'application/json',
  'multipart/form-data',
  'application/x-www-form-urlencoded',
  'application/octet-stream',
  '',
];

/** 清单标识：小写字母 / 数字 / `-_.`，首字符不能是分隔符，长度 1–96 */
export function validManifestIdentifier(value: string): boolean {
  const text = String(value ?? '');
  if (text.length === 0 || text.length > 96) return false;
  return /^[a-z0-9][a-z0-9._-]*$/.test(text);
}

/** 解码并校验清单；失败直接抛错，调用方不得带病落库 */
export function decodeManifest(data: Buffer | string): Manifest {
  let raw: any;
  try {
    raw = JSON.parse(typeof data === 'string' ? data : data.toString('utf8'));
  } catch (error) {
    throw new ManifestError(`插件清单不是合法 JSON：${(error as Error).message}`);
  }
  return normalizeRawManifest(raw);
}

/** 把线上格式（id/name/version 平铺）投影成 Manifest */
export function normalizeRawManifest(raw: any): Manifest {
  if (!raw || typeof raw !== 'object') throw new ManifestError('插件清单必须是对象');
  const manifest: Manifest = {
    apiVersion: String(raw.apiVersion ?? ''),
    metadata: {
      id: String(raw.id ?? '').trim(),
      name: String(raw.name ?? '').trim(),
      version: String(raw.version ?? '').trim(),
      vendor: String(raw.author ?? ''),
      description: String(raw.description ?? ''),
      documentation: String(raw.documentation ?? ''),
      enabled: raw.enabled === undefined ? true : Boolean(raw.enabled),
      installable: Boolean(raw.installable),
    },
    entry: raw.entry,
    surfaces: raw.surfaces,
    runtime: raw.runtime ?? {},
    permissions: raw.permissions,
    configuration: raw.configuration,
    contributes: raw.contributes ?? {},
  };
  validateManifest(manifest);
  return manifest;
}

/** 全量校验：元数据、provider 贡献、支付贡献 */
export function validateManifest(manifest: Manifest): void {
  const seenSms = new Set<string>();
  for (const provider of manifest.contributes?.smsProviders ?? []) {
    if (!validManifestIdentifier(provider.id) || !String(provider.label ?? '').trim() || seenSms.has(provider.id)) {
      throw new ManifestError('短信服务商贡献无效或重复');
    }
    seenSms.add(provider.id);
  }
  if (!ALLOWED_API_VERSIONS.includes(String(manifest.apiVersion ?? '').trim())) {
    throw new ManifestError(`不支持的清单版本：${manifest.apiVersion}`);
  }
  if (!manifest.metadata.id || !manifest.metadata.version) {
    throw new ManifestError('清单元数据缺少 id 或 version');
  }
  if (!manifest.metadata.name) throw new ManifestError('清单元数据缺少 name');
  if (!validManifestIdentifier(manifest.metadata.id)) throw new ManifestError('清单元数据 id 格式无效');
  if (manifest.metadata.name.length > 160 || manifest.metadata.vendor.length > 120) {
    throw new ManifestError('清单元数据 name 或 vendor 过长');
  }
  const providers = manifest.contributes?.providers ?? [];
  if (providers.length === 0 && !hasNonProviderContribution(manifest)) {
    throw new ManifestError('插件必须声明至少一项贡献');
  }
  const backend = String(manifest.runtime?.backend ?? '').trim();
  if (
    backend &&
    !['declarative', 'rpc', 'wasm', 'trusted-backend'].includes(backend) &&
    !backend.startsWith('host:')
  ) {
    throw new ManifestError(`不支持的后端类型：${backend}`);
  }
  if (providers.length === 0) {
    validatePaymentProviders(manifest);
    return;
  }
  validateProviders(providers);
  validatePaymentProviders(manifest);
}

function hasNonProviderContribution(manifest: Manifest): boolean {
  const contributes = manifest.contributes ?? {};
  return [
    contributes.smsProviders,
    contributes.paymentProviders,
    contributes.workflows,
    contributes.canvasNodes,
    contributes.transforms,
    contributes.commands,
    contributes.assetSources,
    contributes.usageObservers,
    contributes.aiCapabilities,
    contributes.agents,
    contributes.importExport,
  ].some((items) => Array.isArray(items) && items.length > 0);
}

function validateProviders(providers: ManifestProvider[]): void {
  const seen = new Set<string>();
  providers.forEach((provider, index) => {
    if (!String(provider.id ?? '').trim() || !String(provider.label ?? '').trim() || !validManifestIdentifier(provider.id)) {
      throw new ManifestError(`第 ${index} 个 provider 需要合法的 id 与 label`);
    }
    if (seen.has(provider.id)) throw new ManifestError(`provider 重复：${provider.id}`);
    seen.add(provider.id);
    validateImageParameters(provider);
    if (!provider.capabilities?.length || !provider.scopes?.length) {
      throw new ManifestError(`provider ${provider.id} 必须声明 capabilities 与 scopes`);
    }
    const kind = provider.kind as ProviderKind | '' | undefined;
    if (kind === 'processing') {
      if (provider.capabilities.length !== 1 || provider.capabilities[0] === 'text') {
        throw new ManifestError(`处理类 provider ${provider.id} 必须且只能声明一个媒体能力`);
      }
    } else if (kind && kind !== 'generation') {
      throw new ManifestError(`不支持的 provider 类型：${kind}`);
    }
    for (const capability of provider.capabilities) {
      if (!MANIFEST_CAPABILITIES.includes(capability)) {
        throw new ManifestError(`不支持的能力：${capability}`);
      }
    }
    for (const scope of provider.scopes) {
      if (!MANIFEST_SURFACES.includes(scope)) {
        throw new ManifestError(`不支持的宿主表面：${scope}`);
      }
    }
    validateOperation(`provider ${provider.id} create`, provider.create);
    if (provider.agent) {
      validateOperation(`provider ${provider.id} agent`, provider.agent);
      if (!provider.agentResponse) {
        throw new ManifestError(`provider ${provider.id} 声明 agent 时必须提供 agentResponse`);
      }
    }
    if (provider.poll) validateOperation(`provider ${provider.id} poll`, provider.poll);
    if (provider.detachedPolling && !provider.poll) {
      throw new ManifestError(`provider ${provider.id} 的 detachedPolling 需要 poll 操作`);
    }
    if (provider.upload) {
      validateOperation(`provider ${provider.id} upload`, provider.upload);
      if (provider.upload.id === undefined || provider.upload.id === null || !provider.upload.kinds?.length) {
        throw new ManifestError(`provider ${provider.id} 的 upload 需要 kinds 与 id 映射`);
      }
      for (const uploadKind of provider.upload.kinds) {
        if (!['image', 'video', 'audio'].includes(uploadKind)) {
          throw new ManifestError(`provider ${provider.id} 的 upload kind 不受支持：${uploadKind}`);
        }
      }
    }
    if (provider.cancel) validateOperation(`provider ${provider.id} cancel`, provider.cancel);
    if (provider.result) validateOperation(`provider ${provider.id} result`, provider.result);
    (provider.validations ?? []).forEach((rule, ruleIndex) => {
      if (rule.assert === undefined || rule.assert === null || !String(rule.message ?? '').trim()) {
        throw new ManifestError(`provider ${provider.id} 的第 ${ruleIndex} 条校验缺少 assert 或 message`);
      }
    });
  });
}

/**
 * 图像参数校验：**必须**用运行期同一份合同校验器。
 *
 * 早先只检查 name 非空，导致「保存时合法、执行时被拒」的清单能装进库；
 * 参考实现额外要求每个参数都有 binding，且 `providerOptions.*` 绑定只能
 * 写入本 provider 的命名空间 —— 否则一个插件可以篡改另一个插件的请求体。
 */
function validateImageParameters(provider: ManifestProvider): void {
  try {
    validateImageParameterContract(provider.imageParameters);
  } catch (error) {
    const reason = error instanceof ModelDomainError ? error.message : (error as Error).message;
    throw new ManifestError(`provider ${provider.id} 的图像参数不合法：${reason}`);
  }
  for (const parameter of provider.imageParameters ?? []) {
    const binding = String(parameter.binding ?? '').trim();
    if (binding === '') {
      throw new ManifestError(`provider ${provider.id} 的图像参数 ${parameter.name} 需要 binding`);
    }
    if (binding.startsWith('providerOptions.') && !binding.startsWith(`providerOptions.${provider.id}.`)) {
      throw new ManifestError(`provider ${provider.id} 的图像参数 ${parameter.name} 必须使用自己的命名空间`);
    }
  }
}

function validatePaymentProviders(manifest: Manifest): void {
  const seen = new Set<string>();
  (manifest.contributes?.paymentProviders ?? []).forEach((provider, index) => {
    const id = String(provider.id ?? '').trim();
    if (!id || !String(provider.label ?? '').trim() || !validManifestIdentifier(id)) {
      throw new ManifestError(`第 ${index} 个支付服务商贡献需要合法的 id 与 label`);
    }
    if (seen.has(id)) throw new ManifestError(`支付服务商重复：${id}`);
    seen.add(id);
    if (!String(provider.icon ?? '').trim()) throw new ManifestError(`支付服务商 ${id} 缺少 icon`);
    if (!['qr_code', 'redirect'].includes(provider.checkoutMode)) {
      throw new ManifestError(`支付服务商 ${id} 的 checkoutMode 不受支持：${provider.checkoutMode}`);
    }
    const policy = provider.expiryPolicy;
    if (!policy || policy.minMinutes <= 0 || policy.defaultMinutes < policy.minMinutes || policy.maxMinutes < policy.defaultMinutes) {
      throw new ManifestError(`支付服务商 ${id} 的过期策略无效`);
    }
    for (const field of provider.identityFields ?? []) {
      if (!String(field ?? '').trim() || String(field).length > 80) {
        throw new ManifestError(`支付服务商 ${id} 的身份字段无效：${field}`);
      }
    }
    for (const response of [provider.notificationSuccess, provider.notificationFailure]) {
      const status = Number(response?.status ?? 0);
      if (status < 0 || status > 599) {
        throw new ManifestError(`支付服务商 ${id} 的通知响应状态无效`);
      }
    }
  });
}

function validateOperation(scope: string, operation: ManifestOperation | undefined): void {
  if (!operation || typeof operation !== 'object') {
    throw new ManifestError(`${scope} 操作缺失`);
  }
  const method = String(operation.method ?? '').trim().toUpperCase();
  if (!ALLOWED_METHODS.includes(method)) {
    throw new ManifestError(`${scope} 使用了不支持的 HTTP 方法：${operation.method}`);
  }
  if (operation.pathTemplate === undefined || operation.pathTemplate === null) {
    const path = String(operation.path ?? '').trim();
    const queryIndex = path.indexOf('?');
    const pathname = queryIndex >= 0 ? path.slice(0, queryIndex) : path;
    if (!pathname.startsWith('/') || pathname.startsWith('//') || /^[a-z]+:\/\//i.test(path)) {
      throw new ManifestError(`${scope} 的路径必须是相对路径：${operation.path}`);
    }
  }
  const contentType = String(operation.contentType ?? 'application/json').split(';')[0].trim().toLowerCase();
  if (!ALLOWED_CONTENT_TYPES.includes(contentType)) {
    throw new ManifestError(`${scope} 的内容类型不受支持：${operation.contentType}`);
  }
  if (operation.files?.length && operation.contentTypeTemplate === undefined && contentType !== 'multipart/form-data') {
    throw new ManifestError(`${scope} 声明了文件字段，但内容类型不是 multipart/form-data`);
  }
  for (const file of operation.files ?? []) {
    if (!String(file.name ?? '').trim() || file.source === undefined || file.source === null) {
      throw new ManifestError(`${scope} 的文件字段需要 name 与 source`);
    }
  }
}

/**
 * 把指定 provider 投影到清单顶层，供执行器直接读取。
 *
 * 参考实现里这是 `normalizeManifestForProvider`；TS 侧不保留 `metadata.create`
 * 这层摘要，执行器只读顶层字段，避免同一份数据两处表达。
 */
export function normalizeManifestForProvider(manifest: Manifest, index: number): Manifest {
  const providers = manifest.contributes?.providers ?? [];
  if (index < 0 || index >= providers.length) {
    throw new ManifestError('插件 provider 贡献缺失');
  }
  const provider = providers[index];
  return {
    ...manifest,
    metadata: {
      ...manifest.metadata,
      id: provider.id,
      name: manifest.metadata.name,
      version: manifest.metadata.version,
    },
    runtime: { ...(manifest.runtime ?? {}), backend: manifest.runtime?.backend || 'declarative' },
    create: provider.create,
    upload: provider.upload,
    agent: provider.agent,
    poll: provider.poll,
    cancel: provider.cancel,
    result: provider.result,
    response: provider.response,
    agentResponse: provider.agentResponse,
    auth: provider.auth,
    validations: provider.validations,
  };
}

/** 单个 provider 的运行时投影（注册表与执行器共用） */
export interface ProviderProjection {
  manifest: Manifest;
  provider: ManifestProvider;
  /** 标准化后端：declarative / rpc / wasm / trusted-backend / host:<name> */
  backend: string;
  /** 是否具备轮询（异步）语义 */
  async: boolean;
  /** 是否支持前置上传 */
  upload: boolean;
}

/** 把清单展开成 provider 级执行项 */
export function projectProviders(manifest: Manifest): ProviderProjection[] {
  const backend = String(manifest.runtime?.backend ?? '').trim() || 'declarative';
  const providers = manifest.contributes?.providers ?? [];
  if (providers.length === 0) return [];
  return providers.map((provider) => ({
    manifest: normalizeManifestForProvider(manifest, providers.indexOf(provider)),
    provider,
    backend,
    async: Boolean(provider.poll),
    upload: Boolean(provider.upload),
  }));
}

/** 操作摘要，用于后台列表展示：`POST /v1/images/generations` */
export function operationSummary(operation: ManifestOperation | undefined): string {
  if (!operation) return '';
  const path = String(operation.path ?? '')
    .replace(/\{\{model\}\}/g, '{model}')
    .replace(/\{\{taskId\}\}/g, '{task_id}');
  return `${String(operation.method ?? '').toUpperCase()} ${path}`;
}
