/**
 * 单次尝试的协议执行：拼请求 → 发送 → 解析。
 *
 * 移植自 open-ai-canvas `internal/app/task_route_executor.go` 的
 * `processTask` 与 `task_execution.go` 的轮询分支。宿主负责编排，协议适配器
 * 只做「翻译」，两边的边界与 `protocol/runtime.ts` 一致。
 *
 * 一次调用必落 `ApiCallLog`：它是「这条线路刚才请求了哪里、上游回了什么」的
 * 唯一证据，结算的 Token 用量也从这里读（`BillingService.settle`）。
 *
 * 失败码归一（顺序即优先级）：
 *   `channel_unavailable` → 请求没发出去，可安全切线；
 *   `upstream_401/403/404/429` → 上游拒绝，同样可切线并触发冷却；
 *   DNS / 代理 / 网络不可达 / TCP 连接被拒 → 建连前失败，可安全切线；
 *   其余（超时 / 5xx / 建连后中断 / 解析失败）→ **不可切线**，停在结果不明。
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { ChannelExecution } from '../channels/channel-runtime.service';
import { OutboundError } from '../infra/outbound';
import { ProtocolExecutor, type ProtocolHttpResponse } from '../protocol/executor';
import type {
  GenerationRequest,
  ProtocolAdapter,
  ProtocolCreateResult,
  ProtocolPollResult,
  ProtocolRequestSpec,
  ProtocolResult,
} from '../protocol/runtime';
import { extractUsage } from '../protocol/usage';
import { preConnectionNetworkFailure, safeRouteFailure } from './task-failure-policy';

/** 上游响应的可读错误（优先取结构化字段，最后退回截断原文） */
export function upstreamErrorText(body: string): string {
  const text = String(body ?? '').trim();
  if (text === '') return '上游没有返回响应体';
  try {
    const payload = JSON.parse(text);
    for (const path of [
      'error.message',
      'error.msg',
      'message',
      'msg',
      'error',
      'base_resp.status_msg',
      'data.message',
      'detail',
    ]) {
      const value = path
        .split('.')
        .reduce<any>(
          (current, key) => (current && typeof current === 'object' ? current[key] : undefined),
          payload,
        );
      if (value !== undefined && value !== null && String(value).trim() !== '')
        return truncate(String(value), 500);
    }
  } catch {
    // 非 JSON 响应按原文返回
  }
  return truncate(text, 500);
}

export function truncate(value: string, limit: number): string {
  const text = String(value ?? '');
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

/** 请求体预览：Buffer 只报体积，内联 base64 折叠，避免把整段二进制写进日志 */
export function safeJson(value: any): string {
  if (value === undefined || value === null) return '';
  if (Buffer.isBuffer(value)) return `<binary ${value.length} bytes>`;
  try {
    return JSON.stringify(value).replace(/(data:[^;"]+;base64,)[A-Za-z0-9+/=]{64,}/g, '$1…');
  } catch {
    return String(value);
  }
}

/** 一次上游调用的结果 */
export interface CallOutcome {
  status: 'succeeded' | 'pending' | 'failed';
  providerStatus: string;
  providerRequestId: string;
  result: ProtocolResult | null;
  stage: string;
  message: string;
  /** 失败时的归一错误码 */
  failureCode: string;
  failureMessage: string;
  /** 失败时是否允许切换线路（见文件头） */
  rejectedNoJob: boolean;
  statusCode: number;
  /** 上游 429 的 Retry-After（毫秒）；未提供时 undefined */
  retryAfterMs?: number;
  durationMs: number;
  latencyMs: number;
}

export interface CallLogInput {
  userId: string;
  taskId: string;
  billingOrderId: string;
  channel: ChannelExecution;
  operation: string;
  requestKind: string;
  billable: boolean;
  spec: ProtocolRequestSpec;
  method: string;
  path: string;
  outcome: CallOutcome;
  pollCount: number;
  requestBody: string;
  responseBody: string;
  upstreamUrl: string;
  /** 业务请求中的视频时长；轮询 GET 没有请求体，不能只靠 requestBody 推断 */
  videoSeconds?: number;
}

@Injectable()
export class TaskExecutorService {
  private readonly log = new Logger(TaskExecutorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly executor: ProtocolExecutor,
  ) {}

  /** 发送 create 请求并解析 */
  async create(
    adapter: ProtocolAdapter,
    channel: ChannelExecution,
    request: GenerationRequest,
  ): Promise<{
    outcome: CallOutcome;
    create: ProtocolCreateResult | null;
    upstreamUrl: string;
    requestBody: string;
    responseBody: string;
    spec: ProtocolRequestSpec;
  }> {
    const startedAt = Date.now();
    let spec: ProtocolRequestSpec | null = null;
    let response: ProtocolHttpResponse | null = null;
    let requestBody = '';
    let responseBody = '';
    let create: ProtocolCreateResult | null = null;
    let failureCode = '';
    let failureMessage = '';
    let statusCode = 0;
    let sent = false;

    try {
      spec = await adapter.buildCreate({ baseUrl: channel.runtime.baseUrl, request });
      requestBody = truncate(safeJson(spec.body), 4000);
      sent = true;
      response = await this.executor.send(spec, channel.runtime);
      statusCode = response.status;
      responseBody = truncate(response.text, 4000);
      if (response.status < 200 || response.status >= 300) {
        failureCode = upstreamFailureCode(response.status);
        failureMessage = `上游返回 HTTP ${response.status}：${upstreamErrorText(response.text)}`;
      } else {
        create = await adapter.parseCreate(response.body, request);
        if (create.status === 'failed') {
          failureCode = 'upstream_rejected';
          // 上游以 200 明确返回失败：任务没有建立，可以切线
          failureMessage = create.message || '上游返回失败状态';
        }
      }
    } catch (error) {
      /*
       * buildCreate 抛错发生在请求写出之前：上游一定没有接下任务。
       * 不能按普通 provider_error 判「结果不明」冻结积分 —— 这是本地协议
       * 构建失败，切线或退款都安全。
       */
      failureCode = sent ? failureCodeOf(error, statusCode) : 'request_invalid';
      failureMessage = error instanceof Error ? error.message : String(error);
    }

    const durationMs = Date.now() - startedAt;
    const status: CallOutcome['status'] =
      failureCode !== ''
        ? 'failed'
        : create && (create.status === 'pending' || create.status === 'processing')
          ? 'pending'
          : create?.status === 'succeeded'
            ? 'succeeded'
            : 'failed';
    if (failureCode === '' && (create === null || create.status === 'cancelled')) {
      failureCode = 'upstream_no_result';
      failureMessage = create?.message || '上游没有返回可用结果';
    }

    return {
      outcome: {
        status: failureCode !== '' ? 'failed' : status,
        providerStatus: String(create?.status ?? ''),
        providerRequestId: String(create?.taskId ?? ''),
        result: create?.result ?? null,
        stage: String(create?.stage ?? ''),
        message: String(create?.message ?? ''),
        failureCode:
          failureCode !== '' ? failureCode : status === 'failed' ? 'upstream_no_result' : '',
        failureMessage: failureMessage || (create?.message ?? ''),
        // 200 明确失败与 HTTP 拒绝都表示「上游没有建立任务」；请求根本没发出去
        // （buildCreate 失败 / 建连前网络失败）也属于这一类。
        rejectedNoJob:
          failureCode !== '' && (safeFailure(failureCode) || failureCode === 'request_invalid'),
        statusCode,
        retryAfterMs: retryAfterMsOf(response?.headers),
        durationMs,
        latencyMs: durationMs,
      },
      create,
      upstreamUrl: response?.url ?? '',
      requestBody,
      responseBody,
      spec: spec ?? { method: 'POST', path: '', contentType: '' },
    };
  }

  /** 轮询一次上游任务 */
  async poll(
    adapter: ProtocolAdapter,
    channel: ChannelExecution,
    request: GenerationRequest,
    taskId: string,
  ): Promise<{
    outcome: CallOutcome;
    poll: ProtocolPollResult | null;
    upstreamUrl: string;
    requestBody: string;
    responseBody: string;
    spec: ProtocolRequestSpec;
  }> {
    const startedAt = Date.now();
    let poll: ProtocolPollResult | null = null;
    let response: ProtocolHttpResponse | null = null;
    let spec: ProtocolRequestSpec | null = null;
    let requestBody = '';
    let responseBody = '';
    let failureCode = '';
    let failureMessage = '';
    let statusCode = 0;

    try {
      if (!adapter.buildPoll || !adapter.parsePoll) {
        throw new Error(`协议 ${adapter.metadata.id} 不支持轮询`);
      }
      spec = await adapter.buildPoll({
        baseUrl: channel.runtime.baseUrl,
        model: channel.providerModelKey,
        request,
        taskId,
      });
      requestBody = truncate(safeJson(spec.body), 4000);
      response = await this.executor.send(spec, channel.runtime);
      statusCode = response.status;
      responseBody = truncate(response.text, 4000);
      if (response.status < 200 || response.status >= 300) {
        failureCode = upstreamFailureCode(response.status);
        failureMessage = `轮询返回 HTTP ${response.status}：${upstreamErrorText(response.text)}`;
      } else {
        poll = await adapter.parsePoll(
          { baseUrl: channel.runtime.baseUrl, model: channel.providerModelKey, request, taskId },
          response.body,
        );
        if (poll.status === 'failed' || poll.status === 'cancelled') {
          // 轮询阶段上游可能已经产出并计费：不允许切线
          failureCode = poll.status === 'cancelled' ? 'upstream_cancelled' : 'upstream_failed';
          failureMessage = poll.message || '上游返回失败状态';
        }
      }
    } catch (error) {
      failureCode = failureCodeOf(error, statusCode);
      failureMessage = error instanceof Error ? error.message : String(error);
    }

    const durationMs = Date.now() - startedAt;
    const status: CallOutcome['status'] =
      failureCode !== '' ? 'failed' : poll?.status === 'succeeded' ? 'succeeded' : 'pending';

    return {
      outcome: {
        status,
        providerStatus: String(poll?.status ?? ''),
        providerRequestId: String(poll?.taskId ?? taskId),
        result: poll?.result ?? null,
        stage: String(poll?.stage ?? ''),
        message: String(poll?.message ?? ''),
        failureCode,
        failureMessage,
        // 轮询阶段的任何失败都可能已计费，一律不切线
        rejectedNoJob: false,
        statusCode,
        retryAfterMs: retryAfterMsOf(response?.headers),
        durationMs,
        latencyMs: durationMs,
      },
      poll,
      upstreamUrl: response?.url ?? '',
      requestBody,
      responseBody,
      spec: spec ?? { method: 'GET', path: '', contentType: '' },
    };
  }

  /** 落一条调用记录。记录失败不影响任务本身。 */
  async logCall(input: CallLogInput): Promise<void> {
    const outcome = input.outcome;
    const usage = extractUsage(outcome.result?.usage);
    const mediaCount =
      (outcome.result?.images?.length ?? 0) +
      (outcome.result?.videos?.length ?? 0) +
      (outcome.result?.audios?.length ?? 0);
    const status =
      outcome.status === 'succeeded'
        ? 'success'
        : outcome.status === 'pending'
          ? 'pending'
          : 'failed';
    try {
      await this.prisma.apiCallLog.create({
        data: {
          userId: input.userId,
          channelId: input.channel.channelId,
          channelName: input.channel.channelName,
          channelModelId: input.channel.channelModelId,
          taskId: input.taskId,
          billingOrderId: input.billingOrderId,
          source: 'task',
          capability: input.channel.capability,
          operation: input.operation,
          requestKind: input.requestKind,
          billable: input.billable,
          apiFormat: input.channel.protocol,
          method: input.method,
          path: input.path,
          model: input.channel.providerModelKey,
          status,
          statusCode: outcome.statusCode,
          durationMs: outcome.durationMs,
          pollCount: input.pollCount,
          providerStatus: outcome.providerStatus,
          inputTokens: usage?.inputTokens ?? 0n,
          outputTokens: usage?.outputTokens ?? 0n,
          cachedTokens: usage?.cachedTokens ?? 0n,
          usageAvailable: usage !== null,
          mediaCount,
          videoSeconds: logVideoSeconds(input),
          providerRequestId: outcome.providerRequestId,
          errorCode: outcome.failureCode,
          error: truncate(outcome.failureMessage, 1000),
          concurrencyLimit: input.channel.concurrencyLimit,
          upstreamUrl: input.upstreamUrl,
          requestContentType: input.spec.contentType,
          requestBody: input.requestBody,
          responseBody: input.responseBody,
          startedAt: new Date(Date.now() - outcome.durationMs),
        },
      });
    } catch (error) {
      this.log.warn(`调用日志写入失败 task=${input.taskId}: ${(error as Error).message}`);
    }
  }
}

/** HTTP 状态 → 归一失败码 */
export function upstreamFailureCode(status: number): string {
  switch (status) {
    case 401:
      return 'upstream_401';
    case 403:
      return 'upstream_403';
    case 404:
      return 'upstream_404';
    case 429:
      return 'upstream_429';
    default:
      return status >= 500 ? `upstream_${status}` : `upstream_http_${status}`;
  }
}

/**
 * 异常 → 归一失败码。
 *
 * `OutboundError` 的 code 直接映射成 `outbound_<code>`。DNS、网络不可达与
 * TCP 连接被拒发生在请求写出前，单独归类为可切线失败；连接建立后的重置 /
 * 超时仍归为结果不明。
 */
export function failureCodeOf(error: unknown, statusCode = 0): string {
  if (error instanceof OutboundError) {
    const code = String(error.code ?? '').trim();
    if (code === 'timeout' || code === 'aborted') return 'timeout';
    if (code === 'network') {
      const preConnection = preConnectionNetworkFailure(error.message);
      if (preConnection) return preConnection;
    }
    return `outbound_${code || 'error'}`;
  }
  if (statusCode > 0) return upstreamFailureCode(statusCode);
  const message = String(error instanceof Error ? error.message : error).toLowerCase();
  if (message.includes('timeout') || message.includes('超时') || message.includes('aborted'))
    return 'timeout';
  if (
    message.includes('fetch failed') ||
    message.includes('econnreset') ||
    message.includes('socket')
  ) {
    return 'connection_error';
  }
  return 'provider_error';
}

/** 该失败码是否允许切换线路（只有「上游明确没接」才可以） */
export function safeFailure(failureCode: string): boolean {
  return safeRouteFailure(failureCode);
}

/**
 * 解析上游 `Retry-After`：支持秒数与 HTTP 日期两种格式。
 *
 * 429 的冷却时长优先用上游给的值；缺失或非法时才回落到 30 秒。
 */
export function retryAfterMsOf(
  headers: Record<string, string | string[] | undefined> | undefined,
): number | undefined {
  const raw = headers?.['retry-after'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  const text = String(value ?? '').trim();
  if (!text) return undefined;
  if (/^\d+$/.test(text)) return Number(text) * 1000;
  const at = Date.parse(text);
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : undefined;
}

/** 从请求体里尽力取按时长计费的秒数（日志展示用，读不到返回空） */
function extractVideoSeconds(requestBody: string): string {
  try {
    const payload = JSON.parse(requestBody);
    const value = payload?.duration ?? payload?.seconds ?? payload?.video_seconds;
    return value === undefined || value === null ? '' : String(value);
  } catch {
    return '';
  }
}

function logVideoSeconds(input: CallLogInput): number {
  const explicit = input.videoSeconds;
  return Math.max(
    0,
    Math.trunc(
      Number(explicit !== undefined ? explicit : extractVideoSeconds(input.requestBody)) || 0,
    ),
  );
}
