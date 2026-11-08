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
Object.defineProperty(exports, "__esModule", { value: true });
exports.OAuthRegistryService = void 0;
const common_1 = require("@nestjs/common");
const oauth_providers_1 = require("./oauth.providers");
/**
 * OAuth provider 注册表。
 *
 * 构造时从环境变量装配一次；启用判定 = 凭据齐全 && 显式开关允许。
 */
let OAuthRegistryService = class OAuthRegistryService {
    constructor() {
        this.providers = (0, oauth_providers_1.buildOAuthProviders)(process.env);
        this.enabledIds = new Set((process.env.OAUTH_ENABLED ?? '')
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean));
    }
    list() {
        return this.providers.map((p) => ({
            id: p.id,
            name: p.name,
            enabled: this.isEnabled(p),
        }));
    }
    /** 未启用或未知 provider 一律返回 undefined，控制器统一报 404 */
    get(id) {
        const provider = this.providers.find((p) => p.id === id);
        return provider && this.isEnabled(provider) ? provider : undefined;
    }
    isEnabled(provider) {
        if (!provider.enabled)
            return false;
        return this.enabledIds.size === 0 || this.enabledIds.has(provider.id);
    }
};
exports.OAuthRegistryService = OAuthRegistryService;
exports.OAuthRegistryService = OAuthRegistryService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [])
], OAuthRegistryService);
//# sourceMappingURL=oauth.registry.js.map