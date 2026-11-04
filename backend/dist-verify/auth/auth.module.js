"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthModule = void 0;
const common_1 = require("@nestjs/common");
const prisma_module_1 = require("../prisma/prisma.module");
const auth_controller_1 = require("./auth.controller");
const auth_service_1 = require("./auth.service");
const account_token_service_1 = require("./account-token.service");
const qr_login_controller_1 = require("./qr-login.controller");
const qr_login_service_1 = require("./qr-login.service");
const oauth_controller_1 = require("./oauth/oauth.controller");
const oauth_service_1 = require("./oauth/oauth.service");
const oauth_registry_1 = require("./oauth/oauth.registry");
const oauth_state_service_1 = require("./oauth/oauth-state.service");
/**
 * 认证模块。
 *
 * 依赖 `EmailService` / `SmsService` 来自全局的 `ChannelsModule`（在
 * AppModule 里注册），本模块不需要 import 它 —— 全局模块只对「在其之后
 * 注册的模块」可见，而 ChannelsModule 排在 AuthModule 之前。
 */
let AuthModule = class AuthModule {
};
exports.AuthModule = AuthModule;
exports.AuthModule = AuthModule = __decorate([
    (0, common_1.Module)({
        imports: [prisma_module_1.PrismaModule],
        controllers: [auth_controller_1.AuthController, qr_login_controller_1.QrLoginController, oauth_controller_1.OAuthController],
        providers: [auth_service_1.AuthService, account_token_service_1.AccountTokenService, qr_login_service_1.QrLoginService, oauth_service_1.OAuthService, oauth_registry_1.OAuthRegistryService, oauth_state_service_1.OAuthStateService],
        exports: [auth_service_1.AuthService, account_token_service_1.AccountTokenService],
    })
], AuthModule);
//# sourceMappingURL=auth.module.js.map