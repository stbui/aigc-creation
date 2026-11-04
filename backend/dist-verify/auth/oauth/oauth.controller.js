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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.OAuthController = void 0;
const common_1 = require("@nestjs/common");
const oauth_service_1 = require("./oauth.service");
const oauth_dto_1 = require("./oauth.dto");
const auth_controller_1 = require("../auth.controller");
const rate_limit_guard_1 = require("../../common/rate-limit.guard");
const RL_OAUTH_AUTHORIZE = {
    name: 'auth-oauth-authorize',
    limit: 20,
    windowSec: 60,
    limitEnv: 'RATE_LIMIT_AUTH_PER_MIN',
};
const RL_OAUTH_CALLBACK = {
    name: 'auth-oauth-callback',
    limit: 30,
    windowSec: 60,
    limitEnv: 'RATE_LIMIT_AUTH_PER_MIN',
};
const RL_OAUTH_COMPLETE = {
    name: 'auth-oauth-complete',
    limit: 30,
    windowSec: 60,
    limitEnv: 'RATE_LIMIT_AUTH_PER_MIN',
};
/**
 * 通用 OAuth 登录入口。
 *
 * 浏览器跳转类端点不能返回统一 JSON 信封：它们在 provider 重定向后
 * 直接回到浏览器地址栏，错误必须也以 302 带回前端完成页，否则用户看到
 * 的是裸 JSON。
 */
let OAuthController = class OAuthController {
    constructor(oauth) {
        this.oauth = oauth;
    }
    /** 前端「第三方登录」按钮只渲染这里列出的 provider */
    providers() {
        return this.oauth.providers();
    }
    async authorize(provider, query, res) {
        try {
            const url = await this.oauth.authorizeUrl(provider, query.returnTo);
            return res.redirect(302, url);
        }
        catch (err) {
            return this.redirectError(res, err.message);
        }
    }
    async callback(provider, code, state, error, errorDescription, res) {
        if (error) {
            return this.redirectError(res, errorDescription || `第三方登录已取消 (${error})`);
        }
        try {
            const result = await this.oauth.handleCallback(provider, code, state);
            const params = new URLSearchParams({
                ticket: result.ticket,
                provider: result.provider,
                ...(result.returnTo ? { returnTo: result.returnTo } : {}),
            });
            return res.redirect(302, `${this.webBase()}/auth/oauth/callback?${params.toString()}`);
        }
        catch (err) {
            return this.redirectError(res, err.message);
        }
    }
    complete(dto, req) {
        return this.oauth.complete(dto.ticket, (0, auth_controller_1.contextOf)(req));
    }
    redirectError(res, message) {
        return res.redirect(302, `${this.webBase()}/auth/oauth/callback?error=${encodeURIComponent(message)}`);
    }
    webBase() {
        return (process.env.WEB_BASE_URL || 'http://localhost:5100').replace(/\/+$/, '');
    }
};
exports.OAuthController = OAuthController;
__decorate([
    (0, common_1.Get)('providers'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], OAuthController.prototype, "providers", null);
__decorate([
    (0, rate_limit_guard_1.RateLimit)(RL_OAUTH_AUTHORIZE),
    (0, common_1.Get)(':provider/authorize'),
    __param(0, (0, common_1.Param)('provider')),
    __param(1, (0, common_1.Query)()),
    __param(2, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, oauth_dto_1.OAuthAuthorizeQueryDto, Object]),
    __metadata("design:returntype", Promise)
], OAuthController.prototype, "authorize", null);
__decorate([
    (0, rate_limit_guard_1.RateLimit)(RL_OAUTH_CALLBACK),
    (0, common_1.Get)(':provider/callback'),
    __param(0, (0, common_1.Param)('provider')),
    __param(1, (0, common_1.Query)('code')),
    __param(2, (0, common_1.Query)('state')),
    __param(3, (0, common_1.Query)('error')),
    __param(4, (0, common_1.Query)('error_description')),
    __param(5, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String, String, String, Object]),
    __metadata("design:returntype", Promise)
], OAuthController.prototype, "callback", null);
__decorate([
    (0, rate_limit_guard_1.RateLimit)(RL_OAUTH_COMPLETE),
    (0, common_1.Post)('complete'),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [oauth_dto_1.OAuthCompleteDto, Object]),
    __metadata("design:returntype", void 0)
], OAuthController.prototype, "complete", null);
exports.OAuthController = OAuthController = __decorate([
    (0, common_1.Controller)('auth/oauth'),
    __metadata("design:paramtypes", [oauth_service_1.OAuthService])
], OAuthController);
//# sourceMappingURL=oauth.controller.js.map