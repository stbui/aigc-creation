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
exports.AuthController = void 0;
exports.contextOf = contextOf;
const common_1 = require("@nestjs/common");
const auth_service_1 = require("./auth.service");
const register_dto_1 = require("./dto/register.dto");
const login_dto_1 = require("./dto/login.dto");
const forgot_password_dto_1 = require("./dto/forgot-password.dto");
const reset_password_dto_1 = require("./dto/reset-password.dto");
const sms_send_dto_1 = require("./dto/sms-send.dto");
const sms_login_dto_1 = require("./dto/sms-login.dto");
const rate_limit_guard_1 = require("../common/rate-limit.guard");
/*
 * 限流配额（按 IP，除注明外）：
 *   register        10 / 分钟 —— 注册本身就是重活（bcrypt），且可被刷号
 *   login           10 / 分钟 —— 暴力破解的正面防线
 *   password/forgot  3 / 小时 —— 每封重置邮件都是真实成本
 *   password/reset   5 / 小时 —— 令牌是一次性的，被刷只浪费 CPU
 *   sms/send        1 / 分钟 + 5 / 天 —— 短信按条计费，双窗口缺一不可
 *   sms/login      10 / 分钟 —— 验证码校验的暴力面
 */
// 注册/登录/短信登录可用 RATE_LIMIT_AUTH_PER_MIN 覆盖：自动化测试会在一分钟内
// 反复建号，生产配额会把测试自己挡住。短信与找回密码不提供该开关。
const RL_REGISTER = { name: 'auth-register', limit: 10, windowSec: 60, limitEnv: 'RATE_LIMIT_AUTH_PER_MIN' };
const RL_LOGIN = { name: 'auth-login', limit: 10, windowSec: 60, limitEnv: 'RATE_LIMIT_AUTH_PER_MIN' };
const RL_FORGOT = { name: 'auth-forgot', limit: 3, windowSec: 3600 };
const RL_RESET = { name: 'auth-reset', limit: 5, windowSec: 3600 };
const RL_SMS_SEND = {
    name: 'auth-sms-send',
    rules: [{ limit: 1, windowSec: 60 }, { limit: 5, windowSec: 86400 }],
};
const RL_SMS_LOGIN = { name: 'auth-sms-login', limit: 10, windowSec: 60, limitEnv: 'RATE_LIMIT_AUTH_PER_MIN' };
/**
 * 请求来源提取。
 *
 * `req.ip` 默认是 socket 地址；本项目**默认不信任** `x-forwarded-for`
 * （见 B5 的 `RATE_LIMIT_TRUST_PROXY` 说明）—— 直接读该头等于让任何人
 * 伪造来源 IP，写进登录审计就是一条假证据。
 */
function contextOf(req) {
    return {
        ip: req.ip,
        ua: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined,
    };
}
// 认证接口 (公开, 无 JWT 守卫): /api/v1/auth/*
let AuthController = class AuthController {
    constructor(authService) {
        this.authService = authService;
    }
    async register(dto) {
        return this.authService.register(dto);
    }
    async login(dto, req) {
        return this.authService.login(dto, contextOf(req));
    }
    /**
     * 申请密码重置。
     *
     * 响应**恒为成功**（防账号枚举），前端文案必须是
     * 「如果该邮箱已注册，重置邮件已发送」而不是「邮件已发送」。
     */
    async forgotPassword(dto, req) {
        return this.authService.forgotPassword(dto, contextOf(req));
    }
    async resetPassword(dto) {
        return this.authService.resetPassword(dto);
    }
    /** 发送短信验证码（用途：登录 / 注册时验证手机号） */
    async sendSms(dto, req) {
        return this.authService.sendSmsCode(dto, contextOf(req));
    }
    async smsLogin(dto, req) {
        return this.authService.smsLogin(dto, contextOf(req));
    }
};
exports.AuthController = AuthController;
__decorate([
    (0, rate_limit_guard_1.RateLimit)(RL_REGISTER),
    (0, common_1.Post)('register'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [register_dto_1.RegisterDto]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "register", null);
__decorate([
    (0, rate_limit_guard_1.RateLimit)(RL_LOGIN),
    (0, common_1.Post)('login'),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [login_dto_1.LoginDto, Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "login", null);
__decorate([
    (0, rate_limit_guard_1.RateLimit)(RL_FORGOT),
    (0, common_1.Post)('password/forgot'),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [forgot_password_dto_1.ForgotPasswordDto, Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "forgotPassword", null);
__decorate([
    (0, rate_limit_guard_1.RateLimit)(RL_RESET),
    (0, common_1.Post)('password/reset'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [reset_password_dto_1.ResetPasswordDto]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "resetPassword", null);
__decorate([
    (0, rate_limit_guard_1.RateLimit)(RL_SMS_SEND),
    (0, common_1.Post)('sms/send'),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [sms_send_dto_1.SmsSendDto, Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "sendSms", null);
__decorate([
    (0, rate_limit_guard_1.RateLimit)(RL_SMS_LOGIN),
    (0, common_1.Post)('sms/login'),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [sms_login_dto_1.SmsLoginDto, Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "smsLogin", null);
exports.AuthController = AuthController = __decorate([
    (0, common_1.Controller)('auth'),
    __metadata("design:paramtypes", [auth_service_1.AuthService])
], AuthController);
//# sourceMappingURL=auth.controller.js.map