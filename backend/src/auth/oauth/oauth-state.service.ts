import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AccountTokenService } from '../account-token.service';

/**
 * OAuth state 与回调后的短时登录票。
 *
 * 两者都是一次性凭据：浏览器只拿到 32 字节随机原值，数据库仅保存 HMAC。
 * 消费使用 `updateMany({ id, usedAt: null })` 做 CAS，因此并发重放最多
 * 有一个请求成功。state 在回调开始时消费；ticket 在换取正式会话时消费。
 */

const STATE_TTL_MS = 10 * 60 * 1000;
const TICKET_TTL_MS = 60 * 1000;

export interface OAuthStatePayload {
  provider: string;
  /** 登录完成后回跳的站内路径。未提供时回落 /workbench */
  returnTo?: string;
  /** 显式绑定流程的发起用户；普通登录为空 */
  linkUserId?: string;
}

export interface OAuthTicketPayload {
  userId: string;
  provider: string;
}

@Injectable()
export class OAuthStateService {
  constructor(private readonly prisma: PrismaService) {}

  async createState(payload: OAuthStatePayload): Promise<string> {
    return this.createChallenge({
      kind: 'state',
      provider: payload.provider,
      linkUserId: payload.linkUserId,
      returnTo: payload.returnTo,
      ttlMs: STATE_TTL_MS,
    });
  }

  async consumeState(raw: string, provider: string): Promise<OAuthStatePayload> {
    const challenge = await this.consumeChallenge(raw, 'state');
    if (challenge.provider !== provider) {
      throw new Error('OAuth state 与 provider 不匹配，请重新发起登录');
    }
    return {
      provider: challenge.provider,
      returnTo: challenge.returnTo ?? undefined,
      linkUserId: challenge.linkUserId ?? undefined,
    };
  }

  async createTicket(payload: OAuthTicketPayload): Promise<string> {
    return this.createChallenge({
      kind: 'ticket',
      provider: payload.provider,
      userId: payload.userId,
      ttlMs: TICKET_TTL_MS,
    });
  }

  async consumeTicket(raw: string): Promise<OAuthTicketPayload> {
    const challenge = await this.consumeChallenge(raw, 'ticket');
    if (!challenge.userId) throw new Error('OAuth 登录票缺少用户标识');
    return { userId: challenge.userId, provider: challenge.provider };
  }

  private async createChallenge(params: {
    kind: 'state' | 'ticket';
    provider: string;
    ttlMs: number;
    userId?: string;
    linkUserId?: string;
    returnTo?: string;
  }): Promise<string> {
    const raw = randomBytes(32).toString('base64url');
    await this.prisma.oAuthChallenge.create({
      data: {
        tokenHash: AccountTokenService.hash(raw),
        kind: params.kind,
        provider: params.provider,
        userId: params.userId ?? null,
        linkUserId: params.linkUserId ?? null,
        returnTo: params.returnTo ?? null,
        expiresAt: new Date(Date.now() + params.ttlMs),
      },
    });
    return raw;
  }

  private async consumeChallenge(raw: string, kind: 'state' | 'ticket') {
    const label = kind === 'state' ? 'OAuth state' : 'OAuth 登录票';
    const tokenHash = AccountTokenService.hash(String(raw || '').trim());
    const record = await this.prisma.oAuthChallenge.findUnique({ where: { tokenHash } });
    if (!record || record.kind !== kind) {
      throw new Error(`${label}无效，请重新登录`);
    }
    if (record.usedAt) throw new Error(`${label}已使用，请重新登录`);
    if (record.expiresAt.getTime() <= Date.now()) {
      throw new Error(`${label}已过期，请重新登录`);
    }
    const claimed = await this.prisma.oAuthChallenge.updateMany({
      where: { id: record.id, usedAt: null, expiresAt: { gt: new Date() } },
      data: { usedAt: new Date() },
    });
    if (claimed.count !== 1) throw new Error(`${label}已使用，请重新登录`);
    return record;
  }
}
