/**
 * 中转调用记录。
 *
 * 与任务路径共用 `ApiCallLog` 表（后台「调用记录」页看的是同一张表），区别只在
 * `source`（`system-channel` / `custom-relay`）与 `requestKind='proxy'`。
 *
 * 两条纪律：
 *   1. **写日志永不抛错**（返回布尔）：调用已经发生，日志写失败不能把成功请求
 *      变成失败响应；但计费侧必须知道结果 —— 日志缺失时 Token 账单无法结算，
 *      调用方据此转 `uncertain` 而不是按预授权金额结清；
 *   2. 请求 / 响应报文先过 `sanitizeCallPayload`：密钥与内嵌媒体不进库。
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { currentRequestId } from '../../common/request-context';
import { extractMediaCount, extractProxyUsage, extractProviderRequestId, type ProxyUsage } from './proxy.payload';

export type ProxyCallSource = 'system-channel' | 'custom-relay';

export interface ProxyCallLogEntry {
  source: ProxyCallSource;
  userId: string;
  channelId: string;
  channelName: string;
  billingOrderId?: string;
  capability: string;
  billable: boolean;
  apiFormat: string;
  method: string;
  path: string;
  model: string;
  status: 'success' | 'failed' | 'pending';
  statusCode: number;
  durationMs: number;
  concurrencyLimit: number;
  upstreamUrl: string;
  requestContentType: string;
  requestBody: string;
  responseBody: string;
  responseBodyBuffer?: Buffer;
  streamed?: boolean;
  errorCode?: string;
  error?: string;
  /** 已解析的用量；不给时从响应体提取 */
  usage?: ProxyUsage | null;
}

@Injectable()
export class ProxyCallLogService {
  private readonly log = new Logger(ProxyCallLogService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 写入一条调用记录。
   *
   * @returns 是否成功落库；调用方在成功请求里用它决定是否能按用量结算
   */
  async record(entry: ProxyCallLogEntry): Promise<boolean> {
    const usage =
      entry.usage !== undefined && entry.usage !== null
        ? entry.usage
        : entry.responseBodyBuffer
          ? extractProxyUsage(entry.responseBodyBuffer, Boolean(entry.streamed))
          : null;
    const mediaCount = entry.responseBodyBuffer ? extractMediaCount(entry.responseBodyBuffer) : 0;
    const providerRequestId = entry.responseBodyBuffer ? extractProviderRequestId(entry.responseBodyBuffer) : '';
    try {
      await this.prisma.apiCallLog.create({
        data: {
          userId: entry.userId,
          requestId: currentRequestId() ?? '',
          channelId: entry.channelId,
          channelName: entry.channelName,
          billingOrderId: entry.billingOrderId ?? '',
          source: entry.source,
          capability: entry.capability,
          operation: 'proxy',
          requestKind: 'proxy',
          billable: entry.billable,
          apiFormat: entry.apiFormat,
          method: entry.method,
          path: truncate(entry.path, 500),
          model: entry.model,
          status: entry.status,
          statusCode: entry.statusCode,
          durationMs: Math.max(0, Math.trunc(entry.durationMs)),
          inputTokens: usage?.inputTokens ?? 0n,
          outputTokens: usage?.outputTokens ?? 0n,
          cachedTokens: usage?.cachedTokens ?? 0n,
          usageAvailable: usage !== null,
          mediaCount,
          providerRequestId,
          errorCode: entry.errorCode ?? '',
          error: truncate(entry.error ?? '', 1000),
          concurrencyLimit: entry.concurrencyLimit,
          upstreamUrl: truncate(entry.upstreamUrl, 2000),
          requestContentType: truncate(entry.requestContentType ?? '', 200),
          requestBody: entry.requestBody,
          responseBody: entry.responseBody,
          startedAt: new Date(Date.now() - Math.max(0, Math.trunc(entry.durationMs))),
        },
      });
      return true;
    } catch (error) {
      this.log.error(`调用记录写入失败：${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }
}

function truncate(value: string, max: number): string {
  const text = String(value ?? '');
  return text.length <= max ? text : text.slice(0, max);
}
