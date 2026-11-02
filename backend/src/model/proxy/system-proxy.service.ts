/**
 * 系统渠道中转：客户端拿本系统的令牌，用服务端配置的渠道与密钥调上游模型。
 *
 * 单请求顺序**不可调整**（与 `docs/channel-model-design.md` §4.3 一致）：
 *   身份 → 分组渠道访问 → 限流（守卫层）→ body 上限 → 提取 model → 协议授权
 *   → SSRF 校验 → 剥离客户端密钥 → 附加渠道头 → 并发槽 → 仅 POST 预留计费
 *   → 上游请求 → 状态码 / 日志 / 流式透传 → 结算或 uncertain 或退款。
 *
 * 为什么每一步都必须发生在这个位置：
 *   · 授权在 SSRF 之前：路径白名单决定「能不能发」，安全校验决定「发到哪里」，
 *     顺序反了会让一个本该 403 的路径先去做 DNS 查询；
 *   · 计费在槽位之后：没拿到槽位等于请求不会发出，先建单再退款会污染账单；
 *   · 结算在日志之后：Token 账单从 `ApiCallLog` 读实际用量，日志没落库就结算
 *     等于按预授权金额扣费。
 *
 * 所有错误都直接用本仓信封写出（`writeProxyError`），不抛给全局过滤器：
 * 中转在流式响应开始后已经没有「再回一个错误」的机会，两条路径混用会出现
 * 「SSE 已发出、过滤器又试图写 500」的双写崩溃。
 */

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { IncomingMessage, ServerResponse } from 'http';
import { AppError } from '../../common/app.exception';
import { UserGroupService } from '../user-groups/user-group.service';
import { ChannelSlotService } from '../tasks/channel-slot.service';
import { ChannelUnavailableError } from '../channels/channel-runtime.service';
import { OutboundError, outboundRequest, validateOutboundUrl } from '../infra/outbound';
import { ensureChatCompletionStreamUsage, sanitizeCallPayload } from './proxy.payload';
import {
  ProxyPathError,
  authorizeSystemProxy,
  geminiModelFromPath,
  isMinimaxVideoQueryPath,
  normalizeProxyPath,
  requestModel,
  stripSecretQuery,
  type SystemProxyAuthorization,
} from './proxy.paths';
import { ProxyChannel, ProxyChannelModel, ProxyChannelService } from './proxy-channel.service';
import { ProxyBillingService } from './proxy-billing.service';
import { ProxyCallLogService } from './proxy-call-log.service';
import { readProxyLimits } from './proxy.config';
import { SYSTEM_PROXY_SOURCE } from './proxy.constants';
import { applyProxyAuth, appendQuery, proxyTargetUrl } from './proxy.upstream';
import {
  beginEventStream,
  copyProxyResponseHeaders,
  copyUpstreamStream,
  isEventStream,
  readUpstreamBody,
  writeProxyError,
  writeProxyResponse,
} from './proxy.http';

/** 一次系统渠道中转请求（body 已按上限读好，控制器只负责搬运） */
export interface SystemProxyRequest {
  userId: string;
  channelId: string;
  method: string;
  /** 渠道 id 之后的上游路径，已包含前导斜杠 */
  providerPath: string;
  query: URLSearchParams;
  contentType: string;
  accept: string;
  scene: string;
  idempotencyKey: string;
  body: Buffer;
  res: ServerResponse;
}

@Injectable()
export class SystemProxyService {
  private readonly log = new Logger(SystemProxyService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly channels: ProxyChannelService,
    private readonly groups: UserGroupService,
    private readonly channelSlots: ChannelSlotService,
    private readonly billing: ProxyBillingService,
    private readonly callLogs: ProxyCallLogService,
  ) {}

  /** 入口：处理一次系统渠道中转，所有响应都由本方法写出 */
  async proxy(input: SystemProxyRequest): Promise<void> {
    const startedAt = Date.now();
    const res = input.res;
    const limits = readProxyLimits(this.config);
    if (!limits.enabled) {
      writeProxyError(res, 503, 50303, '中转服务已关闭');
      return;
    }
    const method = String(input.method ?? '').toUpperCase();

    const channel = await this.channels.loadSystemChannel(input.channelId);
    if (!channel) {
      writeProxyError(res, 404, 40401, '系统渠道不存在或已停用');
      return;
    }

    // 分组渠道访问：与任务准入同样失败关闭
    try {
      const access = await this.groups.accessForUser(input.userId);
      access.requireChannel(channel.id);
    } catch (error) {
      writeProxyError(res, 403, 40301, messageOf(error));
      return;
    }

    let path: string;
    try {
      path = normalizeProxyPath(input.providerPath);
    } catch (error) {
      writeProxyError(res, 400, 40001, messageOf(error));
      return;
    }

    const resolved = await this.resolveProtocol(channel.id, channel.apiFormat, method, path, input);
    if ('status' in resolved) {
      writeProxyError(res, resolved.status, resolved.code, resolved.message);
      return;
    }
    const { channelModel, authorization } = resolved;

    // Token 计费的流式 Chat Completions 必须让上游回最终 usage，否则账单只能转
    // uncertain。只改这一种路径，非流式/非 Token 请求原样透传。
    if (method === 'POST' && channelModel?.billingMode === 'token' && path.endsWith('/chat/completions')) {
      try {
        input.body = ensureChatCompletionStreamUsage(input.body);
      } catch (error) {
        writeProxyError(res, 400, 40001, messageOf(error));
        return;
      }
    }

    // 目标地址：先拼版本前缀，再附上剥离密钥后的查询串
    let target: string;
    try {
      target = appendQuery(
        proxyTargetUrl(channel.baseUrl, path, authorization.family, authorization.defaultPrefix),
        stripSecretQuery(input.query).toString(),
      );
    } catch (error) {
      writeProxyError(res, 400, 40001, messageOf(error));
      return;
    }

    // SSRF：目标必须由本系统发起，且解析结果不得指向内网
    let validated: URL;
    try {
      validated = await validateOutboundUrl(target);
    } catch (error) {
      // 响应码必须是全站 5 位数字码；outboundCode 是内部原因，只进调用日志
      const status = outboundStatus(error);
      writeProxyError(res, status, status === 403 ? 40301 : 50201, messageOf(error));
      return;
    }

    const headers = this.buildHeaders(input, authorization.family, channel.apiKey, channel.headers);

    // 并发槽：与任务派发共享同一个 `ChannelSlotService` 实例，两条入口合起来计
    let release: () => void;
    try {
      release = await this.channelSlots.acquire(channel.id, channel.concurrencyLimit);
    } catch (error) {
      await this.recordCall({
        input,
        channel,
        channelModel,
        authorization,
        target,
        startedAt,
        status: 'failed',
        statusCode: 0,
        error: messageOf(error),
        errorCode: error instanceof ChannelUnavailableError ? error.reason : 'channel_busy',
      });
      const busy = error instanceof ChannelUnavailableError;
      writeProxyError(res, busy ? 429 : 503, busy ? 42901 : 50303, messageOf(error));
      return;
    }

    try {
      // 仅 POST 计费：GET 是模型清单 / 结果查询，不产生模型调用
      let billingOrderId = '';
      if (method === 'POST') {
        if (!channelModel) {
          writeProxyError(res, 400, 40001, '当前请求缺少模型参数，无法计费');
          return;
        }
        try {
          const reservation = await this.billing.reserve({
            userId: input.userId,
            channelModel,
            idempotencyKey: input.idempotencyKey,
            scene: input.scene,
            body: input.body,
          });
          billingOrderId = reservation.order.id;
        } catch (error) {
          await this.recordCall({
            input,
            channel,
            channelModel,
            authorization,
            target,
            startedAt,
            status: 'failed',
            statusCode: 0,
            error: messageOf(error),
            errorCode: 'billing_rejected',
          });
          writeProxyError(res, appStatus(error), appCode(error), messageOf(error));
          return;
        }
      }

      await this.sendAndSettle({
        input,
        channel,
        channelModel,
        authorization,
        target: validated.toString(),
        headers,
        method,
        billingOrderId,
        startedAt,
      });
    } finally {
      release();
    }
  }

  // ── 协议解析 ────────────────────────────────────────────────────────

  /** 从报文 / 路径 / 查询串解析模型与协议，并完成协议授权 */
  private async resolveProtocol(
    channelId: string,
    channelApiFormat: string,
    method: string,
    path: string,
    input: SystemProxyRequest,
  ): Promise<
    | { channelModel: ProxyChannelModel | null; authorization: SystemProxyAuthorization }
    | { status: number; code: number; message: string }
  > {
    // 上游模型清单是渠道级端点：不涉及任何模型条款，也拿不到模型名
    const isModelsList = method === 'GET' && path === '/models';

    let modelName = requestModel(input.contentType, input.body);
    if (!modelName && method === 'GET' && path === '/agnesapi') {
      modelName = String(input.query.get('model_name') ?? '').trim();
    }
    // Gemini 的模型名在路径里：`/models/gemini-2.5-pro:generateContent`
    if (!modelName) modelName = geminiModelFromPath(path);

    let channelModel: ProxyChannelModel | null = null;
    let protocol = '';
    if (!isModelsList) {
      if (modelName) {
        channelModel = await this.channels.findChannelModel(channelId, modelName);
        if (!channelModel) {
          return { status: 403, code: 40301, message: '当前系统渠道未授权该模型或该模型协议尚未配置' };
        }
        protocol = channelModel.protocol;
      } else if (method === 'GET' && isMinimaxVideoQueryPath(path)) {
        if (!(await this.channels.channelHasProtocol(channelId, 'minimax-video'))) {
          return { status: 403, code: 40301, message: '当前系统渠道未授权 MiniMax 视频协议' };
        }
        protocol = 'minimax-video';
      } else {
        return { status: 403, code: 40301, message: '当前系统渠道未授权该模型或该模型协议尚未配置' };
      }
    }

    const metadata = protocol ? this.channels.protocolMetadata(protocol) : null;
    try {
      const authorization = authorizeSystemProxy({
        protocol,
        metadata,
        method,
        path,
        fallbackFamily: String(channelApiFormat ?? '').trim().toLowerCase() === 'gemini' ? 'gemini' : 'openai',
      });
      return { channelModel, authorization };
    } catch (error) {
      if (error instanceof ProxyPathError) return { status: 403, code: 40301, message: error.message };
      throw error;
    }
  }

  // ── 上游请求 ────────────────────────────────────────────────────────

  private buildHeaders(
    input: SystemProxyRequest,
    family: SystemProxyAuthorization['family'],
    apiKey: string,
    channelHeaders: Array<{ name: string; value: string }>,
  ): Record<string, string> {
    const headers: Record<string, string> = {};
    if (input.contentType) headers['Content-Type'] = input.contentType;
    headers['Accept'] = input.accept || 'application/json';
    // 渠道自定义头在前、凭证在后：自定义头不允许覆盖鉴权（`normalizeOutboundHeaders` 已拦截），
    // 这里的顺序只是保证「万一同名，凭证赢」
    for (const header of channelHeaders) headers[header.name] = header.value;
    applyProxyAuth(headers, family, apiKey);
    return headers;
  }

  /** 发送并完成流式 / 非流式透传、日志与结算 */
  private async sendAndSettle(input: {
    input: SystemProxyRequest;
    channel: ProxyChannel;
    channelModel: ProxyChannelModel | null;
    authorization: SystemProxyAuthorization;
    target: string;
    headers: Record<string, string>;
    method: string;
    billingOrderId: string;
    startedAt: number;
  }): Promise<void> {
    const { input: request, channel, channelModel, authorization, target, headers, method, billingOrderId } = input;
    const res = request.res;
    const limits = readProxyLimits(this.config);

    let response: IncomingMessage;
    try {
      response = await outboundRequest(target, {
        method,
        headers,
        body: method === 'GET' ? undefined : request.body,
        timeoutMs: limits.systemTimeoutMs,
        proxyUrl: channel.proxyUrl,
        stream: true,
      });
    } catch (error) {
      if (billingOrderId) {
        await this.billing.uncertain(billingOrderId, '系统渠道连接中断，费用状态待核对');
      }
      await this.recordCall({
        input: request,
        channel,
        channelModel,
        authorization,
        target,
        startedAt: input.startedAt,
        billingOrderId,
        status: 'failed',
        statusCode: 0,
        error: messageOf(error),
        errorCode: outboundCode(error),
      });
      writeProxyError(res, 502, 50201, '系统渠道连接失败');
      return;
    }

    const statusCode = response.statusCode ?? 0;
    const streamed = isEventStream(response.headers);
    const responseLimit = limits.systemResponseBytes;
    let captured = Buffer.alloc(0);
    let readError = '';

    if (streamed) {
      copyProxyResponseHeaders(res, response.headers);
      beginEventStream(res, statusCode);
      const result = await copyUpstreamStream(response, res, responseLimit);
      captured = result.captured;
      if (result.exceeded) readError = '系统渠道流式响应超过配置上限';
    } else {
      let body: Buffer | null = null;
      try {
        body = await readUpstreamBody(response, responseLimit);
      } catch (error) {
        readError = messageOf(error);
      }
      if (readError === '' && body === null) readError = '系统渠道响应超过配置上限';
      captured = body ?? Buffer.alloc(0);
    }

    const success = statusCode >= 200 && statusCode < 300 && readError === '';
    if (readError !== '') {
      // 上游已经响应但本地没读完：可能已产生费用，不自动退款
      if (billingOrderId) await this.billing.uncertain(billingOrderId, `${readError}，费用状态待核对`);
    }

    const logged = await this.recordCall({
      input: request,
      channel,
      channelModel,
      authorization,
      target,
      startedAt: input.startedAt,
      billingOrderId,
      status: success ? 'success' : 'failed',
      statusCode,
      error: readError || (success ? '' : `上游返回 HTTP ${statusCode}`),
      responseBody: captured,
      streamed,
    });

    if (billingOrderId) await this.settleBilling(billingOrderId, statusCode, success, logged);

    if (readError !== '') {
      // SSE 响应头已经发出，只能中断连接；非流式仍能给结构化错误
      if (!streamed) writeProxyError(res, 502, 50201, '系统渠道响应读取失败');
      return;
    }
    if (streamed) return;

    copyProxyResponseHeaders(res, response.headers);
    writeProxyResponse(res, {
      statusCode,
      contentType: headerText(response.headers['content-type']),
      disposition: headerText(response.headers['content-disposition']),
      body: captured,
    });
  }

  /** 计费收尾：成功需已落日志；524 与结算异常转人工，其余明确失败退款 */
  private async settleBilling(
    billingOrderId: string,
    statusCode: number,
    success: boolean,
    logged: boolean,
  ): Promise<void> {
    try {
      if (success) {
        if (!logged) {
          await this.billing.uncertain(billingOrderId, '上游成功但调用日志写入失败，费用状态待核对');
          return;
        }
        await this.billing.settle(billingOrderId);
        return;
      }
      if (statusCode === 524) {
        await this.billing.uncertain(billingOrderId, '上游返回 524，费用状态待核对');
        return;
      }
      await this.billing.refund(billingOrderId, '上游明确返回失败');
    } catch (error) {
      // 结算 / 退款写失败不能当没发生：转待核对，避免账单停在 running 被当成已扣费
      await this.billing.uncertain(billingOrderId, `费用收尾失败，请人工核对：${messageOf(error)}`);
    }
  }

  // ── 调用记录 ────────────────────────────────────────────────────────

  private async recordCall(entry: {
    input: SystemProxyRequest;
    channel: ProxyChannel;
    channelModel: ProxyChannelModel | null;
    authorization: SystemProxyAuthorization;
    target: string;
    startedAt: number;
    /** 已预留的账单 id：Token 结算按它反查本次调用的 usage，漏传会退化成按预授权金额结清 */
    billingOrderId?: string;
    status: 'success' | 'failed';
    statusCode: number;
    error?: string;
    errorCode?: string;
    responseBody?: Buffer;
    streamed?: boolean;
  }): Promise<boolean> {
    const { input, channel, channelModel, authorization } = entry;
    try {
      return await this.callLogs.record({
        source: SYSTEM_PROXY_SOURCE,
        userId: input.userId,
        channelId: channel.id,
        channelName: channel.name,
        channelModelId: channelModel?.id ?? '',
        billingOrderId: entry.billingOrderId,
        capability: channelModel?.capability ?? '',
        billable: String(input.method).toUpperCase() === 'POST',
        apiFormat: channel.apiFormat || authorization.family,
        method: String(input.method).toUpperCase(),
        path: input.providerPath,
        model: channelModel?.modelKey ?? '',
        status: entry.status,
        statusCode: entry.statusCode,
        durationMs: Date.now() - entry.startedAt,
        concurrencyLimit: channel.concurrencyLimit,
        upstreamUrl: entry.target,
        requestContentType: input.contentType,
        requestBody: sanitizeCallPayload(input.body, input.contentType),
        responseBody: sanitizeCallPayload(entry.responseBody ?? Buffer.alloc(0), ''),
        responseBodyBuffer: entry.responseBody,
        streamed: entry.streamed,
        errorCode: entry.errorCode,
        error: entry.error,
      });
    } catch (error) {
      this.log.warn(`中转调用记录写入失败：${messageOf(error)}`);
      return false;
    }
  }
}

// ── 小工具 ────────────────────────────────────────────────────────────

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? '');
}

function appCode(error: unknown): number {
  return error instanceof AppError ? error.code : 40001;
}

function appStatus(error: unknown): number {
  return error instanceof AppError ? error.getStatus() : 400;
}

function outboundStatus(error: unknown): number {
  if (error instanceof OutboundError) {
    return error.code === 'blocked_host' || error.code === 'invalid_url' ? 403 : 502;
  }
  return 502;
}

/** 出站失败原因（写入调用日志，不是响应外的业务码） */
function outboundCode(error: unknown): string {
  return error instanceof OutboundError ? error.code : 'network';
}

function headerText(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return String(value ?? '');
}
