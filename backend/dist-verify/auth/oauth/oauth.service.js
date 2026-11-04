"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var OAuthService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.OAuthService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../prisma/prisma.service");
const app_exception_1 = require("../../common/app.exception");
const oauth_registry_1 = require("./oauth.registry");
const oauth_state_service_1 = require("./oauth-state.service");
const auth_service_1 = require("../auth.service");
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
let OAuthService = OAuthService_1 = class OAuthService {
    constructor(prisma, registry, state, auth) {
        this.prisma = prisma;
        this.registry = registry;
        this.state = state;
        this.auth = auth;
        this.logger = new common_1.Logger(OAuthService_1.name);
    }
    providers() {
        return this.registry.list().filter((p) => p.enabled);
    }
    async authorizeUrl(providerId, returnTo) {
        const provider = this.requireProvider(providerId);
        return provider.buildAuthorizationUrl(this.state.signState({ provider: providerId, returnTo: this.safeReturnTo(returnTo) }));
    }
    async handleCallback(providerId, code, state) {
        const provider = this.requireProvider(providerId);
        if (!code)
            throw new app_exception_1.AppError(40001, 'OAuth 回调缺少 code', 400);
        const payload = this.verifyState(state, providerId);
        const tokens = await provider.exchange(code);
        const profile = await provider.fetchProfile(tokens);
        const userId = await this.resolveUserId(profile);
        const ticket = this.state.signTicket({ sub: userId, provider: providerId });
        return { ticket, provider: providerId, returnTo: payload.returnTo };
    }
    async complete(ticket, ctx = {}) {
        const payload = this.state.verifyTicket(ticket);
        const reason = payload.provider ? `oauth:${payload.provider}` : 'oauth';
        return this.auth.issueSessionFor(payload.sub, ctx, reason);
    }
    requireProvider(providerId) {
        const provider = this.registry.get(providerId);
        if (!provider) {
            throw new app_exception_1.AppError(40402, 'OAuth provider 未配置或未启用', 404);
        }
        return provider;
    }
    verifyState(state, providerId) {
        try {
            return this.state.verifyState(state, providerId);
        }
        catch (err) {
            throw new app_exception_1.AppError(40004, err.message, 400);
        }
    }
    async resolveUserId(profile) {
        if (!profile.subject) {
            throw new app_exception_1.AppError(40001, `${profile.provider} 未返回用户唯一标识`, 400);
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
                    throw new app_exception_1.AppError(40302, '该邮箱关联的账号不可用', 403);
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
        }
        catch (err) {
            this.logger.warn(`OAuth 身份绑定失败 user=${user.id} provider=${profile.provider}: ${err.message}`);
        }
        return user.id;
    }
    async linkIdentity(userId, profile) {
        await this.prisma.oAuthIdentity.create({
            data: { userId, provider: profile.provider, subject: profile.subject },
        });
    }
    safeName(name) {
        const cleaned = String(name ?? '').trim().slice(0, 20);
        return cleaned || '新用户';
    }
    /** 只允许站内绝对路径，拦掉 `//evil.com` 这类开放重定向写法 */
    safeReturnTo(returnTo) {
        if (!returnTo)
            return undefined;
        return returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : undefined;
    }
};
exports.OAuthService = OAuthService;
exports.OAuthService = OAuthService = OAuthService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        oauth_registry_1.OAuthRegistryService,
        oauth_state_service_1.OAuthStateService,
        auth_service_1.AuthService])
], OAuthService);
//# sourceMappingURL=oauth.service.js.map