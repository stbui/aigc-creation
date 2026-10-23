import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AppError } from '../../common/app.exception';
import { OAuthRegistryService } from './oauth.registry';
import { OAuthStateService } from './oauth-state.service';
import { OAuthProfile, OAuthProviderInfo } from './oauth.types';
import { AuthService, type RequestContext } from '../auth.service';

/**
 * 通用 OAuth 登录编排。
 *
 * 流程：
 *   GET /auth/oauth/:provider/authorize   → 生成 state → 302 provider
 *   provider 回调 /auth/oauth/:provider/callback → 验 state → 换 token → 拉 profile
 *     → 找/建/绑本地账号 → 签 60s 短时登录票 → 302 前端完成页
 *   POST /auth/oauth/complete             → 验票 → 签正式 accessToken
 *
 * 安全约束：
 *   - state 绑定 provider 且 10 分钟过期，防 CSRF 与跨 provider 复用；
 *   - 只有 provider 明确确权的 email 才会被用于自动绑定已有账号；
 *   - accessToken 不进 URL，只通过短时登录票在前端换取。
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

  async authorizeUrl(providerId: string, returnTo?: string): Promise<string> {
    const provider = this.requireProvider(providerId);
    return provider.buildAuthorizationUrl(
      this.state.signState({ provider: providerId, returnTo: this.safeReturnTo(returnTo) }),
    );
  }

  async handleCallback(providerId: string, code: string, state: string): Promise<{ ticket: string; provider: string; returnTo?: string }> {
    const provider = this.requireProvider(providerId);
    if (!code) throw new AppError(40001, 'OAuth 回调缺少 code', 400);

    const payload = this.verifyState(state, providerId);
    const tokens = await provider.exchange(code);
    const profile = await provider.fetchProfile(tokens);
    const userId = await this.resolveUserId(profile);

    const ticket = this.state.signTicket({ sub: userId, provider: providerId });
    return { ticket, provider: providerId, returnTo: payload.returnTo };
  }

  async complete(ticket: string, ctx: RequestContext = {}) {
    const payload = this.state.verifyTicket(ticket);
    const reason = payload.provider ? `oauth:${payload.provider}` : 'oauth';
    return this.auth.issueSessionFor(payload.sub, ctx, reason);
  }

  private requireProvider(providerId: string) {
    const provider = this.registry.get(providerId);
    if (!provider) {
      throw new AppError(40402, 'OAuth provider 未配置或未启用', 404);
    }
    return provider;
  }

  private verifyState(state: string, providerId: string) {
    try {
      return this.state.verifyState(state, providerId);
    } catch (err) {
      throw new AppError(40004, (err as Error).message, 400);
    }
  }

  private async resolveUserId(profile: OAuthProfile): Promise<string> {
    if (!profile.subject) {
      throw new AppError(40001, `${profile.provider} 未返回用户唯一标识`, 400);
    }

    const existing = await this.prisma.oAuthIdentity.findUnique({
      where: { provider_subject: { provider: profile.provider, subject: profile.subject } },
    });
    if (existing) {
      await this.prisma.oAuthIdentity
        .update({ where: { id: existing.id }, data: { lastLoginAt: new Date() } })
        .catch(() => undefined);
      return existing.userId;
    }

    const email = profile.email && profile.emailVerified ? profile.email : null;
    if (email) {
      const emailUser = await this.prisma.user.findUnique({ where: { email } });
      if (emailUser) {
        if (emailUser.status !== 'active') {
          throw new AppError(40302, '该邮箱关联的账号不可用', 403);
        }
        await this.linkIdentity(emailUser.id, profile);
        return emailUser.id;
      }
    }

    const user = await this.prisma.user.create({
      data: {
        email: email ?? `${profile.provider}+${profile.subject}@oauth.local`,
        passwordHash: '',
        name: this.safeName(profile.name),
      },
    });

    try {
      await this.linkIdentity(user.id, profile);
    } catch (err) {
      this.logger.warn(`OAuth 身份绑定失败 user=${user.id} provider=${profile.provider}: ${(err as Error).message}`);
    }
    return user.id;
  }

  private async linkIdentity(userId: string, profile: OAuthProfile): Promise<void> {
    await this.prisma.oAuthIdentity.create({
      data: { userId, provider: profile.provider, subject: profile.subject },
    });
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
