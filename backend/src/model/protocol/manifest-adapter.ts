/**
 * 声明式插件的运行时适配器。
 *
 * 移植自 open-ai-canvas `internal/protocol/manifest_adapter.go`。一个插件包可以
 * 声明多个 provider，每个 provider 对应一个适配器实例；适配器只按清单拼请求、
 * 读响应，不与数据库、凭证存储或网络层交互 —— 发请求与下载结果由宿主完成。
 *
 * 之所以每个 provider 单独投影一份清单（而不是共享），是因为执行期只读
 * 顶层字段：投影后适配器拿到的就是「这一个协议」的完整视图，不会再回头
 * 查 `contributes.providers[index]`，避免下标错位导致串号。
 */

import type { Manifest, ManifestProvider, ManifestResponse } from './types';
import type {
  GenerationRequest,
  MediaReference,
  ProtocolAdapter,
  ProtocolAgentRequestContext,
  ProtocolAgentResult,
  ProtocolCreateResult,
  ProtocolMetadata,
  ProtocolPollContext,
  ProtocolPollResult,
  ProtocolRequestContext,
  ProtocolRequestSpec,
  ProtocolResult,
} from './runtime';
import { evaluateManifestValue } from './expression';
import { normalizeManifestForProvider, operationSummary } from './manifest';
import {
  applyImageParameters,
  buildManifestOperation,
  buildManifestOperationWithEnv,
  firstPathValue,
  manifestMediaValues,
  manifestRequestValues,
  validateManifestRequest,
} from './request';
import {
  binaryPayloadCreateResult,
  decodeObject,
  manifestError,
  manifestResponseMedia,
  manifestResponseString,
  mediaPathValues,
  normalizeStatus,
  parseAgentResponse,
  pickQueueAhead,
  streamedJSONAudioCreateResult,
} from './response';

export class ManifestAdapter implements ProtocolAdapter {
  readonly metadata: ProtocolMetadata;

  constructor(
    private readonly provider: ManifestProvider,
    private readonly plugin: { id: string; name: string; version: string; vendor: string; description: string; documentation: string },
    private readonly requiresSecretKey: boolean,
  ) {
    this.metadata = {
      id: provider.id,
      label: provider.label,
      name: plugin.name,
      version: plugin.version,
      vendor: plugin.vendor,
      description: plugin.description,
      documentation: plugin.documentation,
      capabilities: provider.capabilities,
      scopes: provider.scopes,
      kind: provider.kind ?? 'generation',
      async: Boolean(provider.poll),
      upload: Boolean(provider.upload),
      requiresSecretKey,
      imageParameters: provider.imageParameters,
      create: operationSummary(provider.create),
      poll: operationSummary(provider.poll),
      cancel: operationSummary(provider.cancel),
      contentType: String(provider.create?.contentType ?? 'application/json'),
      requiresPublicMediaUrls: Boolean(provider.requiresPublicMediaUrls),
      detachedPolling: Boolean(provider.detachedPolling),
      idempotentCreate: Boolean(provider.idempotentCreate),
      source: 'plugin',
      pluginId: plugin.id,
    };
  }

  buildCreate(context: ProtocolRequestContext): ProtocolRequestSpec {
    const request = applyImageParameters(context.request, this.provider.imageParameters);
    validateManifestRequest(this.provider.validations, request);
    return buildManifestOperation(this.provider.create, this.provider.auth, request, '');
  }

  parseCreate(body: Buffer | string, request?: GenerationRequest): ProtocolCreateResult {
    const response = this.response;
    if (response.streamedJsonAudio) {
      const format = String(request?.extra?.audioFormat ?? '');
      return streamedJSONAudioCreateResult(body, format);
    }
    if (response.binaryPayload) {
      return binaryPayloadCreateResult(String(response.resultKind ?? ''), body);
    }
    const payload = decodeObject(body);
    // 响应映射可读取 request.*（如以宿主幂等键作为上游任务 ID 的协议）
    return this.parse(payload, { model: request?.model ?? '', request: request ?? { model: '' }, taskId: '' });
  }

  buildPoll(context: ProtocolPollContext): ProtocolRequestSpec {
    this.requireOperation('poll');
    const request = { ...context.request, model: context.model };
    return buildManifestOperation(this.provider.poll!, this.provider.auth, request, context.taskId);
  }

  parsePoll(context: ProtocolPollContext, body: Buffer | string): ProtocolPollResult {
    const payload = decodeObject(body);
    const result = this.parse(payload, context);
    return {
      taskId: result.taskId,
      status: result.status,
      result: result.result,
      message: result.message,
      stage: result.stage,
      queueAhead: result.queueAhead,
    };
  }

  buildCancel(context: ProtocolPollContext): ProtocolRequestSpec {
    this.requireOperation('cancel');
    const request = { ...context.request, model: context.model };
    return buildManifestOperation(this.provider.cancel!, this.provider.auth, request, context.taskId);
  }

  buildResult(context: ProtocolPollContext): ProtocolRequestSpec {
    this.requireOperation('result');
    const request = { ...context.request, model: context.model };
    return buildManifestOperation(this.provider.result!, this.provider.auth, request, context.taskId);
  }

  buildUpload(context: ProtocolRequestContext, media: MediaReference): ProtocolRequestSpec {
    this.requireOperation('upload');
    const [value] = manifestMediaValues([media]);
    return buildManifestOperationWithEnv(this.provider.upload!, this.provider.auth, context.request, '', { media: value });
  }

  parseUpload(body: Buffer | string): string {
    this.requireOperation('upload');
    const payload = decodeObject(body);
    const id = manifestResponseString(this.provider.upload!.id, { response: payload });
    if (id.trim() === '') throw new Error('上游素材上传没有返回素材 ID');
    return id;
  }

  buildAgent(context: ProtocolAgentRequestContext): ProtocolRequestSpec {
    this.requireOperation('agent');
    const request: GenerationRequest = { model: context.model, extra: { agent: context.request } };
    return buildManifestOperation(this.provider.agent!, this.provider.auth, request, '');
  }

  parseAgent(body: Buffer | string): ProtocolAgentResult {
    if (!this.provider.agentResponse) {
      throw new Error(`协议 ${this.provider.id} 没有工具调用响应映射`);
    }
    return parseAgentResponse(body, this.provider.agentResponse);
  }

  private requireOperation(name: 'poll' | 'cancel' | 'result' | 'upload' | 'agent'): void {
    const present = Boolean(this.provider[name]);
    if (!present) throw new Error(`协议 ${this.provider.id} 不支持 ${name} 操作`);
  }

  private get response(): ManifestResponse {
    return this.provider.response ?? {};
  }

  /**
   * 通用响应解析：任务号 → 状态 → 文案 → 媒体。
   *
   * 状态为空时按 `pending` 处理：多数异步上游在受理时不返回状态字段。
   * 若状态仍是 pending 但已经拿到了文本或媒体，则判定为同步成功 ——
   * 否则宿主会一直轮询一个其实已经完成的同步协议。
   */
  private parse(payload: Record<string, any>, context: { model: string; request: GenerationRequest; taskId: string }): ProtocolCreateResult {
    const response = this.response;
    const env = {
      response: payload,
      taskId: context.taskId,
      request: manifestRequestValues(context.request),
    };

    let taskId = manifestResponseString(response.taskId, env);
    if (taskId === '') taskId = firstPathValue(payload, ...(response.taskIdPaths ?? []));
    if (taskId === '') taskId = context.taskId;

    let statusText = manifestResponseString(response.status, env);
    if (statusText === '') statusText = firstPathValue(payload, ...(response.statusPaths ?? []));
    let status = normalizeStatus(statusText);
    if (status === '') status = 'pending';

    let message = manifestResponseString(response.message, env);
    if (message === '') message = firstPathValue(payload, ...(response.messagePaths ?? []));

    if (manifestError(payload, response.errorPaths)) status = 'failed';

    const stage = manifestResponseString(response.stage, env);
    const queueAhead = pickQueueAhead(response.queueAhead, env);

    let text = manifestResponseString(response.text, env);
    if (text === '') text = firstPathValue(payload, ...(response.textPaths ?? []));
    let reasoning = manifestResponseString(response.reasoning, env);
    if (reasoning === '') reasoning = firstPathValue(payload, ...(response.reasoningPaths ?? []));

    const result: ProtocolResult = {
      text,
      reasoning,
      images: manifestResponseMedia(response.images, env, 'image', Boolean(response.resultEphemeral)),
      videos: manifestResponseMedia(response.videos, env, 'video', Boolean(response.resultEphemeral)),
      audios: manifestResponseMedia(response.audios, env, 'audio', Boolean(response.resultEphemeral)),
    };
    if (response.usage !== undefined && response.usage !== null) {
      try {
        const usage = evaluateUsage(response.usage, env);
        if (usage) result.usage = usage;
      } catch {
        // 用量映射出错不影响结果交付，最多少记一笔 token
      }
    }

    const resultKind = String(response.resultKind ?? '');
    for (const path of [...(response.resultUrlPaths ?? []), ...(response.resultPaths ?? [])]) {
      for (const url of mediaPathValues(payload, path)) {
        const item: MediaReference = {
          url,
          kind: resultKind,
          ephemeral: Boolean(response.resultEphemeral),
        };
        if (resultKind === 'image') (result.images ??= []).push(item);
        else if (resultKind === 'audio') (result.audios ??= []).push(item);
        else (result.videos ??= []).push(item);
      }
    }

    const hasMedia =
      (result.images?.length ?? 0) + (result.videos?.length ?? 0) + (result.audios?.length ?? 0) > 0;
    if (status === 'pending' && (text !== '' || hasMedia)) status = 'succeeded';

    const emptyResult = text === '' && reasoning === '' && !hasMedia;
    return {
      taskId,
      status,
      result: emptyResult ? null : result,
      message,
      stage,
      queueAhead,
    };
  }
}

/** 用量映射单独包一层：表达式抛错不应中断结果解析 */
function evaluateUsage(template: any, env: Record<string, any>): Record<string, any> | null {
  const value = evaluateManifestValue(template, env);
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

/**
 * 从插件清单创建某个 provider 的适配器。
 *
 * `manifest` 必须是 `decodeManifest` 校验过的原始清单；这里负责投影与实例化，
 * 不重复校验（校验失败在解码阶段就已抛出）。
 */
export function createManifestAdapter(manifest: Manifest, index: number): ManifestAdapter {
  const providers = manifest.contributes?.providers ?? [];
  if (index < 0 || index >= providers.length) {
    throw new Error('插件 provider 贡献缺失');
  }
  const provider = providers[index];
  const plugin = {
    id: manifest.metadata.id,
    name: manifest.metadata.name,
    version: manifest.metadata.version,
    vendor: manifest.metadata.vendor,
    description: manifest.metadata.description,
    documentation: manifest.metadata.documentation,
  };
  // 投影仅用于校验该 provider 可被独立执行（字段齐全）；适配器读取的是 provider 本身
  normalizeManifestForProvider(manifest, index);
  const requiresSecretKey = Boolean(provider.auth?.secretField);
  return new ManifestAdapter(provider, plugin, requiresSecretKey);
}
