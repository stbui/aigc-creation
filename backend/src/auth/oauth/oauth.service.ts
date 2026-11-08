import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AppError } from '../../common/app.exception';
import { AccountTokenService } from '../account-token.service';
import { normalizeEmail } from '../email';
import { OAuthRegistryService } from './oauth.registry';
import { OAuthStateService } from './oauth-state.service';
import { OAuthProfile, OAuthProviderInfo } from './oauth.types';
import { AuthService, type RequestContext } from '../auth.service';

export type OAuthCallbackResult =
  | { linked: true; provider: string }
  | { linked: false; ticket: string; provider: string; returnTo?: string };

/**
 * 通用 OAuth 登录编排。
 *
 * 安全约束：
 *   - state/ticket 都是数据库中一次性、只存 HMAC 的挑战值；
 *   - identity 已存在才允许自动登录，同邮箱账号不会因第三方回调被静默合并；
 *   - 同邮箱已有账号时，用户必须先登录，再走受 JWT 保护的显式绑定入口；
 *   - 新用户与 identity 在同一事务创建，避免产生无法再次登录的半成品账号。
 */
@Injectable()
export class OAuthService {
  private readonly logger = new Logger(OAuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: OAuthRegistryService,
    private readonly state: OAuthStateService,
    private readonly auth: AuthService,
  ) {}

  providers(): OAuthProviderInfo[] {
    return this.registry.list().filter((p) => p.enabled);
  }

  async authorizeUrl(providerId: string, returnTo?: string, linkUserId?: string): Promise<string> {
    const provider = this.requireProvider(providerId);
    const state = await this.state.createState({
      provider: providerId,
      returnTo: this.safeReturnTo(returnTo),
      linkUserId,
    });
    return provider.buildAuthorizationUrl(state);
  }

  async handleCallback(
    providerId: string,
    code: string,
    state: string,
  ): Promise<OAuthCallbackResult> {
    const provider = this.requireProvider(providerId);
    if (!code) throw new AppError(40001, 'OAuth 回调缺少 code', 400);

    // state 必须在任何外部副作用之前消费，避免并发回调重复换取 provider token。
    const payload = await this.verifyState(state, providerId);
    const tokens = await provider.exchange(code);
    const profile = await provider.fetchProfile(tokens);
    if (!profile.subject) {
      throw new AppError(40001, `${profile.provider} 未返回用户唯一标识`, 400);
    }

    if (payload.linkUserId) {
      await this.linkIdentity(payload.linkUserId, profile);
      return { linked: true, provider: providerId };
    }

    const userId = await this.resolveLoginUser(profile);
    const ticket = await this.state.createTicket({ userId, provider: providerId });
    return { linked: false, ticket, provider: providerId, returnTo: payload.returnTo };
  }

  async complete(ticket: string, ctx: RequestContext = {}) {
    let payload: { userId: string; provider: string };
    try {
      payload = await this.state.consumeTicket(ticket);
    } catch (err) {
      throw new AppError(40004, (err as Error).message, 400);
    }
    const reason = payload.provider ? `oauth:${payload.provider}` : 'oauth';
    return this.auth.issueSessionFor(payload.userId, ctx, reason);
  }

  private requireProvider(providerId: string) {
    const provider = this.registry.get(providerId);
    if (!provider) {
      throw new AppError(40402, 'OAuth provider 未配置或未启用', 404);
    }
    return provider;
  }

  private async verifyState(state: string, providerId: string) {
    try {
      return await this.state.consumeState(state, providerId);
    } catch (err) {
      throw new AppError(40004, (err as Error).message, 400);
    }
  }

  private async resolveLoginUser(profile: OAuthProfile): Promise<string> {
    const existing = await this.prisma.oAuthIdentity.findUnique({
      where: { provider_subject: { provider: profile.provider, subject: profile.subject } },
    });
    if (existing) {
      await this.prisma.oAuthIdentity
        .update({ where: { id: existing.id }, data: { lastLoginAt: new Date() } })
        .catch(() => undefined);
      return existing.userId;
    }

    const verifiedEmail = profile.email && profile.emailVerified
      ? normalizeEmail(profile.email)
      : null;
    if (verifiedEmail) {
      const emailUser = await this.prisma.user.findUnique({ where: { email: verifiedEmail } });
      if (emailUser) {
        throw new AppError(
          40901,
          '该邮箱已注册，请先使用原账号登录，再在账号设置中显式绑定此第三方账号',
          409,
        );
      }
    }

    const fallbackEmail = this.fallbackEmail(profile.provider, profile.subject);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            email: verifiedEmail ?? fallbackEmail,
            emailVerifiedAt: verifiedEmail ? new Date() : null,
            passwordHash: '',
            name: this.safeName(profile.name),
          },
        });
        await tx.oAuthIdentity.create({
          data: {
            userId: user.id,
            provider: profile.provider,
            subject: profile.subject,
            lastLoginAt: new Date(),
          },
        });
        return user.id;
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new AppError(
          40901,
          '该第三方账号或邮箱已被绑定，请先使用原账号登录',
          409,
        );
      }
      throw err;
    }
  }

  /** 显式绑定当前登录用户。重复绑定同一 identity 幂等，跨账号绑定拒绝。 */
  private async linkIdentity(userId: string, profile: OAuthProfile): Promise<void> {
    const existing = await this.prisma.oAuthIdentity.findUnique({
      where: { provider_subject: { provider: profile.provider, subject: profile.subject } },
    });
    if (existing) {
      if (existing.userId !== userId) {
        throw new AppError(40901, '该第三方账号已绑定其他用户', 409);
      }
      await this.prisma.oAuthIdentity.update({
        where: { id: existing.id },
        data: { lastLoginAt: new Date() },
      });
      return;
    }

    try {
      await this.prisma.oAuthIdentity.create({
        data: {
          userId,
          provider: profile.provider,
          subject: profile.subject,
          lastLoginAt: new Date(),
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new AppError(40901, '该第三方账号已绑定其他用户', 409);
      }
      throw err;
    }
    this.logger.log(`OAuth 显式绑定成功 user=${userId} provider=${profile.provider}`);
  }

  private fallbackEmail(provider: string, subject: string): string {
    const digest = AccountTokenService.hash(`${provider}:${subject}`).slice(0, 32);
    return `oauth-${provider}-${digest}@oauth.local`;
  }

  private safeName(name: string | null): string {
    const cleaned = String(name ?? '').trim().slice(0, 20);
    return cleaned || '新用户';
  }

  /** 只允许站内绝对路径，拦掉 `//evil.com` 这类开放重定向写法 */
  private safeReturnTo(returnTo: string | undefined): string | undefined {
    if (!returnTo) return undefined;
    return returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : undefined;
  }
}
