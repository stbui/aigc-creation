/**
 * 自定义渠道中转：用户自带上游地址与密钥，本系统只做「安全的转发」。
 *
 * 与系统渠道中转的三处本质差异：
 *   1. **不计费** —— 上游费用由用户自己的 Key 承担，所以没有账单、没有结算；
 *   2. **目标与凭证都来自请求头** —— 因此出站校验用更严的 `strictRelay`
 *      （禁止 HTTP、禁止重定向、拒绝保留网段），否则这个接口就是一台开放代理；
 *   3. **响应必须脱敏** —— 用户把 Key 交给我们转发，上游错误信息经常原样回显它；
 *      不脱敏等于把用户的密钥写进他自己的浏览器控制台与我们的日志。
 *
 * 为什么密钥走 `x-canvas-upstream-key` 而不是 `Authorization`：本系统的鉴权
 * 占用了 `Authorization: Bearer <本系统令牌>`，两者不能共用一个头。
 */

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { IncomingMessage, ServerResponse } from 'http';
import { OutboundError, outboundRequest, parseOutboundHeaders, validateCustomRelayUrl, type OutboundHeader } from '../infra/outbound';
import { ModelCatalogClient } from '../catalog/model-catalog.client';
import { ModelDomainError } from '../domain/json';
import type { ChannelModelCatalogItem } from '../catalog/model-catalog.types';
import { authorizeCustomRelay, mediaTypeOf, type CustomRelayFormat } from './proxy.paths';
import {
  CUSTOM_RELAY_FORMAT_HEADER,
  CUSTOM_RELAY_HEADERS_HEADER,
  CUSTOM_RELAY_KEY_HEADER,
  CUSTOM_RELAY_URL_HEADER,
} from './proxy.constants';
import { readProxyLimits } from './proxy.config';
import { CustomRelaySlotService } from './custom-relay-slot.service';
import { applyProxyAuth } from './proxy.upstream';
import {
  RelayStreamRedactor,
  allowsBinaryResponse,
  beginEventStream,
  copyRedactedStream,
  copyProxyResponseHeaders,
  isEventStream,
  readUpstreamBody,
  redactSecret,
  writeProxyError,
  writeProxyResponse,
} from './proxy.http';

/** 上游失败时最多透传多少错误正文（够看清原因，又不至于把大响应变成放大器） */
const MAX_ERROR_BODY_BYTES = 64 * 1024;
const MAX_API_KEY_LENGTH = 512;

/** 允许二进制透传的路径族：视频内容下载与语音合成 */
const VIDEO_CONTENT_PATH = /(?:^|\/)videos\/[^/]+\/content$/;

export interface CustomRelayRequest {
  userId: string;
  method: string;
  headers: Record<string, string | undefined>;
  query: URLSearchParams;
  contentType: string;
  accept: string;
  body: Buffer;
  res: ServerResponse;
}

@Injectable()
export class CustomRelayService {
  private readonly log = new Logger(CustomRelayService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly slots: CustomRelaySlotService,
    private readonly catalog: ModelCatalogClient,
  ) {}

  /** 转发一次自定义渠道请求 */
  async relay(input: CustomRelayRequest): Promise<void> {
    const res = input.res;
    const limits = readProxyLimits(this.config);
    if (!limits.enabled) {
      writeProxyError(res, 503, 50303, '中转服务已关闭');
      return;
    }
    const method = String(input.method ?? '').toUpperCase();

    // 1. 目标地址：自定义渠道用严格判定（禁重定向、禁 HTTP、禁保留网段）
    let target: URL;
    try {
      target = await validateCustomRelayUrl(String(input.headers[CUSTOM_RELAY_URL_HEADER] ?? ''));
    } catch (error) {
      writeProxyError(res, 403, 40301, outboundMessage(error));
      return;
    }

    // 2. 格式与路径授权
    const format = String(input.headers[CUSTOM_RELAY_FORMAT_HEADER] ?? '').trim().toLowerCase() || 'openai';
    if (!isSupportedFormat(format)) {
      writeProxyError(res, 400, 40001, '自定义渠道调用格式仅支持 openai / gemini / claude');
      return;
    }
    try {
      authorizeCustomRelay({
        method,
        path: target.pathname,
        query: target.searchParams,
        format,
        contentType: input.contentType,
      });
    } catch (error) {
      writeProxyError(res, 403, 40301, messageOf(error));
      return;
    }

    // 3. 上游密钥与自定义头
    const apiKey = String(input.headers[CUSTOM_RELAY_KEY_HEADER] ?? '');
    if (!isValidApiKey(apiKey)) {
      writeProxyError(res, 401, 40101, '自定义渠道 API Key 无效');
      return;
    }
    let outboundHeaders: OutboundHeader[];
    try {
      outboundHeaders = decodeRelayHeaders(input.headers[CUSTOM_RELAY_HEADERS_HEADER]);
    } catch (error) {
      writeProxyError(res, 400, 40001, messageOf(error));
      return;
    }

    // 4. 体积与请求形态
    if (method === 'GET' && input.body.length > 0) {
      writeProxyError(res, 400, 40001, '模型列表请求不允许携带请求体');
      return;
    }

    // 5. 按用户并发槽（拿不到直接 429，不排队）
    const release = this.slots.acquire(input.userId, limits.customConcurrency);
    if (!release) {
      writeProxyError(res, 429, 42901, '自定义渠道并发请求过多，请等待已有请求完成');
      return;
    }

    try {
      const headers: Record<string, string> = {};
      if (input.contentType) headers['Content-Type'] = input.contentType;
      headers['Accept'] = input.accept || 'application/json';
      for (const header of outboundHeaders) headers[header.name] = header.value;
      applyProxyAuth(headers, format, apiKey);

      let upstream: IncomingMessage;
      try {
        upstream = await outboundRequest(target.toString(), {
          method,
          headers,
          body: method === 'GET' ? undefined : input.body,
          timeoutMs: limits.customTimeoutMs,
          strictRelay: true,
          stream: true,
        });
      } catch (error) {
        writeProxyError(res, 502, 50201, '自定义渠道上游连接失败');
        this.log.warn(`自定义中转上游连接失败：${messageOf(error)}`);
        return;
      }

      await this.writeResponse(res, upstream, apiKey, target.pathname, limits.customResponseBytes);
    } finally {
      release();
    }
  }

  /** 拉取用户自定义渠道的上游模型目录（`POST /ai/models`） */
  async listModels(input: {
    baseUrl: string;
    apiKey: string;
    apiFormat?: string;
    headers?: OutboundHeader[];
  }): Promise<ChannelModelCatalogItem[]> {
    try {
      return await this.catalog.fetch({
        baseUrl: input.baseUrl,
        apiKey: input.apiKey,
        apiFormat: input.apiFormat,
        headers: input.headers,
      });
    } catch (error) {
      if (error instanceof ModelDomainError) throw error;
      throw new ModelDomainError(messageOf(error) || '拉取上游模型目录失败', 50201);
    }
  }

  // ── 响应 ────────────────────────────────────────────────────────────

  private async writeResponse(
    res: ServerResponse,
    upstream: IncomingMessage,
    apiKey: string,
    upstreamPath: string,
    responseLimit: number,
  ): Promise<void> {
    const statusCode = upstream.statusCode ?? 0;
    const streamed = isEventStream(upstream.headers);

    if (statusCode < 200 || statusCode >= 300) {
      await this.writeUpstreamError(res, upstream, apiKey, statusCode);
      return;
    }

    if (streamed) {
      copyProxyResponseHeaders(res, upstream.headers);
      beginEventStream(res, statusCode);
      const result = await copyRedactedStream(upstream, res, responseLimit, new RelayStreamRedactor(apiKey));
      if (result.exceeded) this.log.warn('自定义中转流式响应超过上限，已中断');
      return;
    }

    let body: Buffer | null;
    try {
      body = await readUpstreamBody(upstream, responseLimit);
    } catch (error) {
      writeProxyError(res, 502, 50201, '自定义渠道响应读取失败');
      return;
    }
    if (body === null) {
      writeProxyError(res, 502, 50201, '自定义渠道上游返回了过大的响应');
      return;
    }

    const contentType = headerText(upstream.headers['content-type']);
    const mediaType = mediaTypeOf(contentType);
    if (allowsBinary(upstreamPath) && allowsBinaryResponse(mediaType)) {
      writeProxyResponse(res, { statusCode, contentType, body });
      return;
    }
    if (mediaType !== 'application/json' && !mediaType.endsWith('+json')) {
      writeProxyError(res, 502, 50201, '自定义渠道上游返回了不支持的内容类型');
      return;
    }
    const redacted = Buffer.from(redactSecret(body.toString('utf8'), apiKey), 'utf8');
    writeProxyResponse(res, { statusCode, contentType: 'application/json; charset=utf-8', body: redacted });
  }

  /** 上游明确失败：尽量透传原始错误（已脱敏），并只读不超 64KB */
  private async writeUpstreamError(
    res: ServerResponse,
    upstream: IncomingMessage,
    apiKey: string,
    statusCode: number,
  ): Promise<void> {
    let body: Buffer | null;
    try {
      body = await readUpstreamBody(upstream, MAX_ERROR_BODY_BYTES);
    } catch {
      body = null;
    }
    if (body === null) {
      writeProxyError(res, 502, 50201, '自定义渠道上游请求失败');
      return;
    }
    const text = redactSecret(body.toString('utf8'), apiKey).trim();
    const contentType = headerText(upstream.headers['content-type']);
    if (isJsonLike(contentType) && isJson(text)) {
      writeProxyResponse(res, {
        statusCode,
        contentType: 'application/json; charset=utf-8',
        body: Buffer.from(text, 'utf8'),
      });
      return;
    }
    const snippet = text.length > 200 ? `${text.slice(0, 200)}...` : text;
    writeProxyError(res, statusCode, 50201, snippet === '' ? '自定义渠道上游请求失败' : `自定义渠道上游请求失败：${snippet}`);
  }
}

// ── 小工具 ────────────────────────────────────────────────────────────

function isSupportedFormat(value: string): value is CustomRelayFormat {
  return value === 'openai' || value === 'gemini' || value === 'claude';
}

/** 密钥形态：非空、限长、不含换行（否则可以注入额外的请求头） */
function isValidApiKey(value: string): boolean {
  const key = String(value ?? '').trim();
  return key !== '' && key.length <= MAX_API_KEY_LENGTH && !/[\r\n]/.test(key);
}

/** 自定义出站头：base64(JSON `[{name,value}]`)，再走统一的规范化校验 */
function decodeRelayHeaders(encoded: string | undefined): OutboundHeader[] {
  const text = String(encoded ?? '').trim();
  if (text === '') return [];
  let json: string;
  try {
    json = Buffer.from(text, 'base64').toString('utf8');
  } catch {
    throw new Error('自定义请求头编码无效');
  }
  try {
    return parseOutboundHeaders(json);
  } catch (error) {
    throw new Error(`自定义请求头无效：${messageOf(error)}`);
  }
}

function allowsBinary(path: string): boolean {
  return VIDEO_CONTENT_PATH.test(path) || path.endsWith('/audio/speech');
}

function isJsonLike(contentType: string): boolean {
  const mediaType = mediaTypeOf(contentType);
  return mediaType === 'application/json' || mediaType.endsWith('+json');
}

function isJson(text: string): boolean {
  if (text === '') return false;
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

function outboundMessage(error: unknown): string {
  if (error instanceof OutboundError) return error.message;
  return messageOf(error) || '自定义渠道地址无效';
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? '');
}

function headerText(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return String(value ?? '');
}
