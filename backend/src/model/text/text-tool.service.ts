/**
 * 文本工具调用（提示词润色 / 图片转提示词）。
 *
 * 与生成任务的区别：产出是**文字**，没有任务、没有轮询、没有账单 ——
 * 用户按一次润色不该在作品列表里多出一条记录。但它仍走**真实协议**：
 * 渠道模型 → 协议 adapter → 统一出站层，凭证、SSRF、超时与自定义头全部
 * 复用任务链路，不另开一条「工具专用」的 HTTP 通道。
 *
 * ## 模型从哪里来
 *
 * 取 `ChannelModel.capability='text'` 且自身与所属渠道都启用的候选，按渠道
 * `sortOrder` → 模型 `sortOrder` 依次尝试。第一条失败就换下一条：文本工具是
 * 同步调用，用户看不到「内部切线」的过程，但也不能因为第一条线路 401 就整体失败。
 *
 * ## 不交付伪结果
 *
 * 没有可用文本线路、或全部线路失败时抛 `50201`（HTTP 502），**不拼接模板文案**。
 * 每次尝试写一条 `ApiCallLog`（`source='tool'`、`billable=false`），排障时能在
 * 后台调用记录里看到「这条线路请求了哪里、上游回了什么」。
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AppError } from '../../common/app.exception';
import {
  ChannelRuntimeService,
  ChannelUnavailableError,
  type ChannelExecution,
} from '../channels/channel-runtime.service';
import { ProtocolExecutor, type ProtocolHttpResponse } from '../protocol/executor';
import { extractUsage } from '../protocol/usage';
import type { GenerationMessage, GenerationRequest, MediaReference } from '../protocol/runtime';

export interface TextToolCall {
  /** 写进调用记录的 operation，如 `prompt_polish` / `image_to_prompt` */
  operation: string;
  /** 系统指令；声明式协议会把它注入 messages 的 system 角色 */
  instructions: string;
  /** 纯文本输入（与 `messages` 二选一或并用） */
  prompt?: string;
  /** 已构造好的消息（多轮 / 多模态） */
  messages?: GenerationMessage[];
  /** 图片等参考素材；走 data URL，不依赖上游回拉本站地址 */
  images?: MediaReference[];
  maxTokens?: number;
  temperature?: number;
  /** 调用记录归属；工具接口都是登录态，传当前用户 */
  userId?: string;
}

export interface TextToolResult {
  text: string;
  /** 上游实际使用的模型键（不是本站 modelKey） */
  model: string;
  channelModelId: string;
  usage?: Record<string, any>;
}

const MAX_TOKENS_DEFAULT = 1024;
const BODY_PREVIEW_CHARS = 4000;
const ERROR_PREVIEW_CHARS = 1000;

interface TextCandidate {
  channelModelId: string;
  sortOrder: number;
  channelSortOrder: number;
}

@Injectable()
export class TextToolService {
  private readonly log = new Logger(TextToolService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly channels: ChannelRuntimeService,
    private readonly executor: ProtocolExecutor,
  ) {}

  /**
   * 同步文本调用。
   *
   * 每条候选失败都写一条调用记录并继续下一条；全部失败时只抛最后一条的原因 ——
   * 用户看到的是「文本模型调用失败」加一句可读原因，完整清单在调用记录与进程日志里。
   */
  async generate(call: TextToolCall): Promise<TextToolResult> {
    const candidates = await this.candidates();
    if (candidates.length === 0) {
      throw new AppError(50201, '没有可用的文本模型：请在后台渠道工作台配置 text 能力的渠道模型', 502);
    }

    let lastError = '';
    for (const candidate of candidates) {
      let channel: ChannelExecution;
      try {
        channel = await this.channels.prepare(candidate.channelModelId);
      } catch (error) {
        lastError = messageOf(error);
        // 渠道在派发前就不可用：请求没发出去，没有调用记录可写
        if (!(error instanceof ChannelUnavailableError)) {
          this.log.warn(`文本线路装配失败 channel-model=${candidate.channelModelId}: ${lastError}`);
        }
        continue;
      }

      const request = this.buildRequest(channel, call);
      const startedAt = Date.now();
      let response: ProtocolHttpResponse | null = null;
      let path = '';
      let method = 'POST';
      try {
        const spec = await channel.adapter.buildCreate({ baseUrl: channel.runtime.baseUrl, request });
        path = spec.path;
        method = spec.method;
        response = await this.executor.send(spec, channel.runtime);
        const parsed = await this.readText(channel, request, response);
        await this.logCall({
          call,
          channel,
          request,
          response,
          method,
          path,
          status: 'success',
          errorCode: '',
          error: '',
          startedAt,
        });
        return {
          text: parsed.text,
          model: channel.providerModelKey,
          channelModelId: channel.channelModelId,
          usage: parsed.usage,
        };
      } catch (error) {
        lastError = messageOf(error);
        await this.logCall({
          call,
          channel,
          request,
          response,
          method,
          path,
          status: 'failed',
          errorCode: error instanceof TextUpstreamError ? error.code : failureCodeOf(error),
          error: lastError,
          startedAt,
        });
        this.log.warn(`文本调用失败 channel-model=${channel.channelModelId}: ${lastError}`);
      }
    }

    throw new AppError(50201, `文本模型调用失败：${lastError || '所有渠道均不可用'}`, 502);
  }

  private buildRequest(channel: ChannelExecution, call: TextToolCall): GenerationRequest {
    return {
      capability: 'text',
      model: channel.providerModelKey,
      instructions: call.instructions,
      prompt: call.prompt,
      messages: call.messages,
      images: call.images,
      /*
       * 采样参数按协议命名空间下发：清单模板读
       * `request.providerOptions.<plugin-id>.max_tokens`，写在顶层字段上会被静默忽略。
       */
      providerOptions: {
        [channel.protocol]: {
          max_tokens: call.maxTokens ?? MAX_TOKENS_DEFAULT,
          temperature: call.temperature,
        },
      },
    };
  }

  /**
   * 解析 create 响应。
   *
   * 非 2xx 与 `failed` / 空文本都抛错：文本工具没有「先建任务稍后取结果」的路径，
   * 到这里没拿到文字就是失败。
   */
  private async readText(
    channel: ChannelExecution,
    request: GenerationRequest,
    response: ProtocolHttpResponse,
  ): Promise<{ text: string; usage?: Record<string, any> }> {
    if (response.status < 200 || response.status >= 300) {
      throw new TextUpstreamError(
        `upstream_${response.status}`,
        `上游返回 HTTP ${response.status}：${snippet(response.text)}`,
      );
    }
    const create = await channel.adapter.parseCreate(response.body, request);
    if (create.status !== 'succeeded') {
      throw new TextUpstreamError('upstream_rejected', create.message || '上游没有返回成功的文本结果');
    }
    const text = String(create.result?.text ?? '').trim();
    if (text === '') throw new TextUpstreamError('upstream_no_result', '上游返回成功但没有文本内容');
    return { text, usage: create.result?.usage };
  }

  /**
   * 候选线路：启用 + 未删的 text 渠道模型，且所属渠道启用、未删。
   *
   * 不做价格过滤 —— 文本工具不扣积分，没有账单，价格配置缺失不该拦住「润色一下」；
   * 真正该拦的是渠道 / 模型本身不可用。
   */
  private async candidates(): Promise<TextCandidate[]> {
    const models = await this.prisma.channelModel.findMany({
      where: { capability: 'text', enabled: true, deletedAt: null },
      select: { id: true, channelId: true, sortOrder: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    if (models.length === 0) return [];
    const channels = await this.prisma.modelChannel.findMany({
      where: {
        id: { in: [...new Set(models.map((row) => row.channelId))] },
        enabled: true,
        deletedAt: null,
      },
      select: { id: true, sortOrder: true },
    });
    const channelOrder = new Map(channels.map((row) => [row.id, row.sortOrder]));
    return models
      .filter((row) => channelOrder.has(row.channelId))
      .map((row) => ({
        channelModelId: row.id,
        sortOrder: row.sortOrder,
        channelSortOrder: channelOrder.get(row.channelId) ?? 0,
      }))
      .sort(
        (left, right) =>
          left.channelSortOrder - right.channelSortOrder || left.sortOrder - right.sortOrder,
      );
  }

  /** 调用记录：失败也写，`billable=false`（文本工具不扣积分） */
  private async logCall(input: {
    call: TextToolCall;
    channel: ChannelExecution;
    request: GenerationRequest;
    response: ProtocolHttpResponse | null;
    method: string;
    path: string;
    status: 'success' | 'failed';
    errorCode: string;
    error: string;
    startedAt: number;
  }): Promise<void> {
    const usage = extractUsage(readUsage(input.response));
    try {
      await this.prisma.apiCallLog.create({
        data: {
          userId: input.call.userId ?? '',
          channelId: input.channel.channelId,
          channelName: input.channel.channelName,
          channelModelId: input.channel.channelModelId,
          source: 'tool',
          capability: 'text',
          operation: input.call.operation,
          requestKind: 'create',
          billable: false,
          apiFormat: input.channel.protocol,
          method: input.method,
          path: input.path,
          model: input.channel.providerModelKey,
          status: input.status,
          statusCode: input.response?.status ?? 0,
          durationMs: Date.now() - input.startedAt,
          inputTokens: usage?.inputTokens ?? 0n,
          outputTokens: usage?.outputTokens ?? 0n,
          cachedTokens: usage?.cachedTokens ?? 0n,
          usageAvailable: usage !== null,
          errorCode: input.errorCode,
          error: input.error.slice(0, ERROR_PREVIEW_CHARS),
          concurrencyLimit: input.channel.concurrencyLimit,
          upstreamUrl: input.response?.url ?? '',
          requestContentType: 'application/json',
          requestBody: previewJson(input.request),
          responseBody: String(input.response?.text ?? '').slice(0, BODY_PREVIEW_CHARS),
          startedAt: new Date(input.startedAt),
        },
      });
    } catch (error) {
      // 记录写不进去不该打断业务：用户要的是提示词，不是审计的完整性
      this.log.warn(`文本调用记录写入失败 channel-model=${input.channel.channelModelId}: ${messageOf(error)}`);
    }
  }
}

/** 上游明确失败：带归一的失败码，写进调用记录 */
class TextUpstreamError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'TextUpstreamError';
  }
}

/** 从响应体里尽力取 `usage`（解析失败按「上游没给用量」处理） */
function readUsage(response: ProtocolHttpResponse | null): Record<string, any> | null {
  const text = String(response?.text ?? '').trim();
  if (text === '') return null;
  try {
    const payload = JSON.parse(text);
    return payload && typeof payload === 'object' ? (payload.usage ?? null) : null;
  } catch {
    return null;
  }
}

function failureCodeOf(error: unknown): string {
  const message = messageOf(error).toLowerCase();
  if (message.includes('timeout') || message.includes('超时') || message.includes('aborted')) return 'timeout';
  return 'provider_error';
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function snippet(text: string): string {
  return String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

/** 请求体预览：内联 base64 折叠，避免把整张图写进调用记录 */
function previewJson(value: unknown): string {
  try {
    return String(JSON.stringify(value) ?? '').replace(
      /(data:[^;"]+;base64,)[A-Za-z0-9+/=]{64,}/g,
      '$1…',
    );
  } catch {
    return '';
  }
}
