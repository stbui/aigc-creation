/**
 * 渠道模型连通性测试（后台「测试」按钮）。
 *
 * 移植自 open-ai-canvas `TestAdminChannelModel`：测试复用**真实协议、真实出站
 * 策略与真实凭证**，但**不创建用户任务、不产生计费订单**。区别只在于测试
 * 请求用固定的最小参数（一张图 / 一段短视频），避免测试本身花掉大额费用。
 *
 * 无论成功或失败都必须落 `ApiCallLog`：这张表是「刚才到底请求了哪里、用了
 * 哪个模型、上游返回了什么」的唯一证据，排障与对账都依赖它。测试记录
 * `billable=false`、`source='admin'`、`requestKind='task'`。
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SecretCipher } from '../infra/secret-cipher';
import { badRequest } from '../domain/json';
import { OutboundError, parseOutboundHeaders } from '../infra/outbound';
import { decodeCapabilityConfig, type ModelCapabilityConfig } from '../domain/capability-config';
import { imageParameterAppliesTo, isImageParameterEnabled, resolveImageParameters, type ImageParameter } from '../domain/image-parameters';
import { ProtocolCatalogService } from './protocol-catalog.service';
import { ProtocolRegistry } from './registry';
import { ProtocolExecutor, type ProtocolChannelRuntime } from './executor';
import type {
  GenerationRequest,
  ProtocolAdapter,
  ProtocolCreateResult,
  ProtocolStatus,
  ProtocolResult,
} from './runtime';

/** 测试请求的参数（与保存渠道模型的请求同形，未落库） */
export interface ProtocolTestRequest {
  modelKey?: string;
  providerModelKey?: string;
  displayName?: string;
  capability?: string;
  protocol?: string;
  capabilityConfig?: unknown;
  /** 已保存模型的 id；给出时以库内配置为准补全字段 */
  modelId?: string;
  /** 是否等待异步结果；默认 true */
  waitForResult?: boolean;
  /** 等待上限（毫秒），默认 5 分钟 */
  timeoutMs?: number;
}

export interface ProtocolTestResult {
  status: 'succeeded' | 'failed' | 'pending';
  providerStatus: string;
  durationMs: number;
  pollCount: number;
  taskId: string;
  mediaCount: number;
  text: string;
  message: string;
  errorCode: string;
  error: string;
  /** 实际发送的请求摘要（不含鉴权头） */
  request: { method: string; path: string; contentType: string; model: string; protocol: string };
  /** 归一化后的产出摘要；二进制大字段只报数量 */
  result: { images: number; videos: number; audios: number; text: string };
  /** 上游原始响应（截断） */
  responsePreview: string;
  logId: string;
}

const TEST_PROMPTS: Record<string, string> = {
  text: 'Reply with OK.',
  image: 'A simple gray circle on a white background.',
  video: 'A static gray circle on a white background.',
  audio: 'Model test.',
};

const DEFAULT_POLL_INTERVAL_MS = 3000;
const DEFAULT_POLL_TIMEOUT_MS = 5 * 60 * 1000;
const BODY_PREVIEW_CHARS = 4000;

@Injectable()
export class ProtocolTestService {
  private readonly log = new Logger(ProtocolTestService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cipher: SecretCipher,
    private readonly executor: ProtocolExecutor,
    private readonly registry: ProtocolRegistry,
    private readonly catalog: ProtocolCatalogService,
  ) {}

  async test(channelId: string, input: ProtocolTestRequest, actorId: string): Promise<ProtocolTestResult> {
    const channel = await this.prisma.modelChannel.findFirst({
      where: { id: channelId, scope: 'system', deletedAt: null },
    });
    if (!channel) throw badRequest('系统渠道不存在或已删除', 40400);
    if (String(channel.baseUrl ?? '').trim() === '') throw badRequest('请先在渠道中配置 Base URL');
    if (String(channel.apiKey ?? '').trim() === '') throw badRequest('请先在渠道中配置 API Key');

    // 已保存的模型：表单未改动的字段以库内配置为准（后台列表直接点「测试」的场景）
    const saved = input.modelId
      ? await this.prisma.channelModel.findFirst({ where: { id: input.modelId, channelId, deletedAt: null } })
      : null;
    if (input.modelId && !saved) throw badRequest('渠道模型不存在或已删除', 40400);

    const capability = String(input.capability ?? saved?.capability ?? '').trim();
    const protocolId = String(input.protocol ?? saved?.protocol ?? '').trim();
    if (!capability) throw badRequest('测试需要指定能力');
    if (!protocolId) throw badRequest('测试需要指定协议');
    // 保存期同一套校验：未知协议、处理类协议、能力不匹配都在发请求之前拒绝
    this.catalog.require(protocolId, capability);
    const adapter = this.registry.resolve(protocolId);
    if (!adapter) throw badRequest(`协议 ${protocolId} 尚未注册执行器`);

    const providerModelKey = String(input.providerModelKey ?? saved?.providerModelKey ?? input.modelKey ?? '').trim();
    if (!providerModelKey) throw badRequest('测试需要指定上游模型键');

    const runtime: ProtocolChannelRuntime = {
      baseUrl: String(channel.baseUrl ?? '').trim(),
      credentials: {
        apiKey: this.cipher.decrypt(String(channel.apiKey ?? '')),
        secretKey: this.cipher.decrypt(String(channel.secretKey ?? '')),
      },
      headers: this.parseHeaders(channel.headersJson),
      proxyUrl: String(channel.proxyUrl ?? '').trim() || null,
    };

    const rawConfig = input.capabilityConfig !== undefined && input.capabilityConfig !== null
      ? JSON.stringify(input.capabilityConfig)
      : String(saved?.capabilityConfigJson ?? '');
    const config = decodeCapabilityConfig(rawConfig) ?? null;
    const request = this.buildRequest(adapter, capability, providerModelKey, config);

    const startedAt = new Date();
    const deadline = Date.now() + (input.timeoutMs ?? DEFAULT_POLL_TIMEOUT_MS);
    const waitForResult = input.waitForResult !== false;
    let spec: { method: string; path: string; contentType: string } = { method: '', path: '', contentType: '' };
    let pollCount = 0;
    let statusCode = 0;
    let providerStatus = '';
    let errorCode = '';
    let error = '';
    let upstreamUrl = '';
    let responsePreview = '';
    let requestPreview = '';
    let createResult: ProtocolCreateResult | null = null;
    let finalResult: ProtocolResult | null = null;
    let status: ProtocolStatus = 'failed';
    let taskId = '';

    try {
      const createSpec = await adapter.buildCreate({ baseUrl: runtime.baseUrl, request });
      spec = { method: createSpec.method, path: createSpec.path, contentType: createSpec.contentType };
      requestPreview = truncate(safeJson(createSpec.body));
      const response = await this.executor.send(createSpec, runtime);
      statusCode = response.status;
      upstreamUrl = response.url;
      responsePreview = truncate(response.text);
      if (response.status < 200 || response.status >= 300) {
        errorCode = 'upstream_http_error';
        throw new Error(`上游返回 HTTP ${response.status}：${upstreamErrorText(response.text)}`);
      }
      createResult = await adapter.parseCreate(response.body, request);
      status = createResult.status;
      providerStatus = createResult.status ?? '';
      taskId = createResult.taskId ?? '';
      finalResult = createResult.result ?? null;
      if (createResult.status === 'failed') {
        errorCode = 'upstream_failed';
        error = createResult.message || '上游返回失败状态';
      }

      if (waitForResult && (status === 'pending' || status === 'processing') && adapter.buildPoll && taskId) {
        while (Date.now() < deadline) {
          await sleep(DEFAULT_POLL_INTERVAL_MS);
          pollCount += 1;
          const pollSpec = await adapter.buildPoll({
            baseUrl: runtime.baseUrl,
            model: providerModelKey,
            request,
            taskId,
            metadata: undefined,
          });
          spec = { method: pollSpec.method, path: pollSpec.path, contentType: pollSpec.contentType };
          const pollResponse = await this.executor.send(pollSpec, runtime);
          statusCode = pollResponse.status;
          upstreamUrl = pollResponse.url;
          responsePreview = truncate(pollResponse.text);
          if (pollResponse.status < 200 || pollResponse.status >= 300) {
            errorCode = 'upstream_http_error';
            throw new Error(`轮询返回 HTTP ${pollResponse.status}：${upstreamErrorText(pollResponse.text)}`);
          }
          const pollResult = await adapter.parsePoll!(
            { baseUrl: runtime.baseUrl, model: providerModelKey, request, taskId },
            pollResponse.body,
          );
          status = pollResult.status;
          providerStatus = pollResult.status;
          if (pollResult.result) finalResult = pollResult.result;
          if (pollResult.taskId) taskId = pollResult.taskId;
          if (pollResult.status === 'failed') {
            errorCode = 'upstream_failed';
            error = pollResult.message || '上游返回失败状态';
          }
          if (status !== 'pending' && status !== 'processing') break;
        }
      }
    } catch (caught) {
      error = (caught as Error).message;
      if (caught instanceof OutboundError) errorCode = `outbound_${caught.code}`;
      else if (errorCode === '') errorCode = 'test_failed';
    }

    const mediaCount =
      (finalResult?.images?.length ?? 0) + (finalResult?.videos?.length ?? 0) + (finalResult?.audios?.length ?? 0);
    const text = String(finalResult?.text ?? '');
    const durationMs = Date.now() - startedAt.getTime();
    const logStatus = status === 'succeeded' ? 'success' : status === 'pending' || status === 'processing' ? 'pending' : 'failed';

    const logRow = await this.prisma.apiCallLog.create({
      data: {
        userId: actorId,
        channelId,
        channelName: String(channel.name ?? ''),
        // 线路级健康指标的归属键：能定位到已保存的渠道模型就记它的 id
        channelModelId: String(saved?.id ?? ''),
        source: 'admin',
        capability,
        operation: 'admin_model_test',
        requestKind: 'task',
        billable: false,
        apiFormat: String(channel.apiFormat ?? ''),
        method: spec.method,
        path: spec.path,
        model: String(input.modelKey ?? saved?.modelKey ?? providerModelKey),
        status: logStatus,
        statusCode,
        durationMs,
        pollCount,
        providerStatus,
        mediaCount,
        providerRequestId: taskId,
        errorCode,
        error: truncate(error, 1000),
        concurrencyLimit: channel.concurrencyLimit,
        upstreamUrl,
        requestContentType: spec.contentType,
        requestBody: requestPreview,
        responseBody: responsePreview,
        startedAt,
      },
    });

    if (error !== '') this.log.warn(`渠道模型测试失败（${channelId}/${providerModelKey}）：${error}`);

    return {
      status: status === 'succeeded' ? 'succeeded' : status === 'pending' || status === 'processing' ? 'pending' : 'failed',
      providerStatus,
      durationMs,
      pollCount,
      taskId,
      mediaCount,
      text: truncate(text, 500),
      message: createResult?.message ?? '',
      errorCode,
      error,
      request: { ...spec, model: providerModelKey, protocol: protocolId },
      result: {
        images: finalResult?.images?.length ?? 0,
        videos: finalResult?.videos?.length ?? 0,
        audios: finalResult?.audios?.length ?? 0,
        text: truncate(text, 200),
      },
      responsePreview,
      logId: logRow.id,
    };
  }

  /**
   * 组装测试请求：取模型声明的默认值（比例 / 分辨率 / 时长），
   * 不写死通用 1K 值 —— 固定分辨率的 SKU 会被通用测试值误伤。
   */
  private buildRequest(
    adapter: ProtocolAdapter,
    capability: string,
    providerModelKey: string,
    config: ModelCapabilityConfig | null,
  ): GenerationRequest {
    const request: GenerationRequest = {
      capability: capability as GenerationRequest['capability'],
      model: providerModelKey,
      prompt: TEST_PROMPTS[capability] ?? 'Model test.',
      imageCount: 1,
      extra: { audioFormat: 'mp3', audioVoice: 'alloy', audioSpeed: '1' },
    };

    if (capability === 'image') {
      const image = config?.image;
      const definitions = adapter.metadata.imageParameters ?? [];
      const configured = image?.parameters ?? [];
      const resolved =
        definitions.length > 0 ? resolveImageParameters(definitions, configured, providerModelKey) : ([] as ImageParameter[]);
      const values: Record<string, any> = {};
      for (const parameter of resolved) {
        if (!isImageParameterEnabled(parameter) || !imageParameterAppliesTo(parameter, providerModelKey)) continue;
        const fallback = parameter.default ?? (parameter.values?.length ? parameter.values[0] : undefined);
        if (fallback !== undefined && fallback !== null) values[parameter.name] = fallback;
      }
      if (Object.keys(values).length > 0) request.imageParameters = values;
      if (image?.size && image.size.parameter !== 'none') request.aspectRatio = image.size.default;
      if (image?.resolution?.supported) request.resolution = image.resolution.default;
      if (image?.quality?.supported) request.quality = image.quality.default;
    }

    if (capability === 'video') {
      const video = config?.video;
      request.duration = video?.duration?.default ?? 6;
      request.aspectRatio = video?.defaultRatio ?? '16:9';
      request.resolution = video?.defaultResolution ?? '720';
      request.generateAudio = false;
      request.watermark = false;
      request.operation = video?.defaultOperation ?? '';
    }

    return request;
  }

  private parseHeaders(raw: string) {
    const value = String(raw ?? '').trim();
    if (value === '') return [];
    try {
      return parseOutboundHeaders(this.cipher.decrypt(value));
    } catch {
      // 渠道头配置损坏不应让测试整体失败；出站层会再次校验
      return [];
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 请求体预览：Buffer 只报体积，data URL 的内联字节折叠掉，避免把整段二进制写进调用记录 */
function safeJson(value: any): string {
  if (value === undefined || value === null) return '';
  if (Buffer.isBuffer(value)) return `<binary ${value.length} bytes>`;
  try {
    return JSON.stringify(value).replace(/(data:[^;"]+;base64,)[A-Za-z0-9+/=]{64,}/g, '$1…');
  } catch {
    return String(value);
  }
}

function truncate(value: string, limit = BODY_PREVIEW_CHARS): string {
  const text = String(value ?? '');
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

/** 从上游错误响应里提取可读原因：常见字段优先，最后退回原文截断 */
function upstreamErrorText(body: string): string {
  const text = String(body ?? '').trim();
  if (text === '') return '上游没有返回响应体';
  try {
    const payload = JSON.parse(text);
    for (const path of ['error.message', 'error.msg', 'message', 'msg', 'error', 'base_resp.status_msg', 'data.message']) {
      const value = path.split('.').reduce<any>((current, key) => (current && typeof current === 'object' ? current[key] : undefined), payload);
      if (value !== undefined && value !== null && String(value).trim() !== '') return truncate(String(value), 500);
    }
  } catch {
    // 非 JSON 响应按原文返回
  }
  return truncate(text, 500);
}
