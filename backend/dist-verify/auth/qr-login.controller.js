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
exports.QrLoginController = void 0;
const common_1 = require("@nestjs/common");
const auth_controller_1 = require("./auth.controller");
const qr_login_service_1 = require("./qr-login.service");
const qr_dto_1 = require("./dto/qr.dto");
const jwt_auth_guard_1 = require("../common/jwt-auth.guard");
const current_user_decorator_1 = require("../common/current-user.decorator");
const rate_limit_guard_1 = require("../common/rate-limit.guard");
/*
 * 限流口径 (B2 的 RateLimitGuard):
 *
 *   create   10 / 分钟 / IP —— 每次建码落一行库, 且二维码是凭据类入口, 与登录同档
 *   status  120 / 分钟 / IP —— 1.5s 轮询 = 40 次/分钟, 留三倍余量;
 *                             桌面端多标签页同时登录也不会被自己挡住
 *   scan     30 / 分钟 / 用户 —— 扫码要已登录, 按用户而非 IP 计
 *   confirm  30 / 分钟 / 用户 —— 同上
 *
 * create / status 提供 limitEnv: 自动化测试会在秒级反复建码轮询, 生产配额
 * 会把测试自己挡在门外 (与 login 同一处理)。scan / confirm 按用户计,
 * 天然不会因测试账号数量多而互相挤占。
 */
const RL_QR_CREATE = {
    name: 'auth-qr-create',
    limit: 10,
    windowSec: 60,
    limitEnv: 'RATE_LIMIT_AUTH_PER_MIN',
};
const RL_QR_STATUS = {
    name: 'auth-qr-status',
    limit: 120,
    windowSec: 60,
    limitEnv: 'RATE_LIMIT_AUTH_PER_MIN',
};
const RL_QR_SCAN = { name: 'auth-qr-scan', scope: 'user', limit: 30, windowSec: 60 };
const RL_QR_CONFIRM = {
    name: 'auth-qr-confirm',
    scope: 'user',
    limit: 30,
    windowSec: 60,
};
/**
 * 扫码登录 (B8)。
 *
 * 两个端点公开 (create / status), 两个需要已登录 (scan / confirm) ——
 * 语义就是「桌面建码 → 手机 (已登录) 确认 → 桌面换取会话」。
 * 状态机与安全约束见 `qr-login.service.ts` 顶部说明。
 */
let QrLoginController = class QrLoginController {
    constructor(qr) {
        this.qr = qr;
    }
    /** 桌面端建码。返回票据明文 (仅此一次), 由前端渲染成二维码 */
    create(req) {
        return this.qr.create((0, auth_controller_1.contextOf)(req));
    }
    /** 桌面端轮询。confirmed 时本次响应即携带 accessToken, 票据随即作废 */
    status(query, req) {
        return this.qr.status(query.ticket, (0, auth_controller_1.contextOf)(req));
    }
    /** 手机端扫码: 只标记已扫描, 不授权 */
    scan(dto) {
        return this.qr.scan(dto.ticket);
    }
    /** 手机端确认/拒绝: 唯一真正绑定账号的一步 */
    confirm(dto, user) {
        // 缺省视为同意: 只传 ticket 的客户端也能完成登录, 显式 false 才是拒绝
        return this.qr.confirm(dto.ticket, user.id, dto.approve !== false);
    }
};
exports.QrLoginController = QrLoginController;
__decorate([
    (0, rate_limit_guard_1.RateLimit)(RL_QR_CREATE),
    (0, common_1.Post)('create'),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], QrLoginController.prototype, "create", null);
__decorate([
    (0, rate_limit_guard_1.RateLimit)(RL_QR_STATUS),
    (0, common_1.Get)('status'),
    __param(0, (0, common_1.Query)()),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [qr_dto_1.QrStatusQueryDto, Object]),
    __metadata("design:returntype", void 0)
], QrLoginController.prototype, "status", null);
__decorate([
    (0, rate_limit_guard_1.RateLimit)(RL_QR_SCAN),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, common_1.Post)('scan'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [qr_dto_1.QrTicketDto]),
    __metadata("design:returntype", void 0)
], QrLoginController.prototype, "scan", null);
__decorate([
    (0, rate_limit_guard_1.RateLimit)(RL_QR_CONFIRM),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, common_1.Post)('confirm'),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [qr_dto_1.QrConfirmDto, Object]),
    __metadata("design:returntype", void 0)
], QrLoginController.prototype, "confirm", null);
exports.QrLoginController = QrLoginController = __decorate([
    (0, common_1.Controller)('auth/qr'),
    __metadata("design:paramtypes", [qr_login_service_1.QrLoginService])
], QrLoginController);
//# sourceMappingURL=qr-login.controller.js.map