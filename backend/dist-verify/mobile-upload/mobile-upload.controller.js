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
exports.MobileUploadController = void 0;
const common_1 = require("@nestjs/common");
const platform_express_1 = require("@nestjs/platform-express");
const jwt_auth_guard_1 = require("../common/jwt-auth.guard");
const current_user_decorator_1 = require("../common/current-user.decorator");
const mobile_upload_service_1 = require("./mobile-upload.service");
const app_exception_1 = require("../common/app.exception");
const class_validator_1 = require("class-validator");
/** 手机端上传的请求体 (令牌) */
class ReceiveUploadDto {
}
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)({ message: '上传令牌不能为空' }),
    (0, class_validator_1.MaxLength)(128),
    __metadata("design:type", String)
], ReceiveUploadDto.prototype, "token", void 0);
/**
 * 手机上传接口。
 *
 * ## 鉴权分两种
 *
 *   电脑端接口 (创建/轮询/取消) → JwtAuthGuard: 是登录用户在操作自己的会话。
 *   手机端接口 (接收图片)      → **令牌鉴权**: 手机是另一台设备, 强制它登录
 *                                会把"扫码即用"变成"扫码先注册"。令牌由电脑端
 *                                登录用户在自己的会话里生成, 短时有效, 猜不到。
 */
let MobileUploadController = class MobileUploadController {
    constructor(service) {
        this.service = service;
    }
    /** 电脑端: 创建会话 (返回二维码内容与令牌) */
    async create(user, projectId) {
        if (!projectId) {
            throw new app_exception_1.AppError(40001, 'projectId 必传', 400);
        }
        const s = await this.service.create(user.id, projectId);
        return {
            sessionId: s.id,
            token: s.token,
            expiresAt: s.expiresAt,
            status: s.status,
        };
    }
    /** 电脑端: 轮询会话状态 (看手机端是否已传图) */
    status(user, id) {
        const s = this.service.status(user.id, id);
        return {
            sessionId: s.id,
            status: s.status,
            /** 已接收的素材列表 (多图) —— 顺序即构图顺序 */
            assets: s.assets,
            // 兼容字段: 第一张
            assetId: s.assetId,
            assetUrl: s.assetUrl,
            originalFilename: s.originalFilename,
            expiresAt: s.expiresAt,
        };
    }
    /** 电脑端: 取消会话 */
    cancel(user, id) {
        this.service.cancel(user.id, id);
        return { ok: true };
    }
    /**
     * 手机端: 上传图片 (令牌鉴权, 无需登录)。
     *
     * 用 memoryStorage 收文件: 手机端图片经前端压缩后已很小 (通常 < 2MB),
     * 一次性读进内存再交给存储层, 比落临时盘再搬一次简单, 也少一次 IO。
     */
    async receive(id, dto, files) {
        if (!files?.length) {
            throw new app_exception_1.AppError(40001, '缺少图片文件', 400);
        }
        const s = await this.service.receive(id, dto.token, files.map((f) => ({
            filename: f.originalname || '手机上传图片',
            mimetype: f.mimetype,
            data: f.buffer,
        })));
        return {
            ok: true,
            status: s.status,
            assetId: s.assetId,
            /** 全部素材 (多图) —— 顺序即构图顺序 */
            assets: s.assets,
        };
    }
};
exports.MobileUploadController = MobileUploadController;
__decorate([
    (0, common_1.Post)('sessions'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Body)('projectId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], MobileUploadController.prototype, "create", null);
__decorate([
    (0, common_1.Get)('sessions/:id'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], MobileUploadController.prototype, "status", null);
__decorate([
    (0, common_1.Delete)('sessions/:id'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], MobileUploadController.prototype, "cancel", null);
__decorate([
    (0, common_1.Post)('sessions/:id/receive'),
    (0, common_1.UseInterceptors)((0, platform_express_1.FilesInterceptor)('file', 9, {
        storage: undefined, // 走默认 memoryStorage
        limits: { fileSize: 20 * 1024 * 1024 },
    })),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.UploadedFiles)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, ReceiveUploadDto, Array]),
    __metadata("design:returntype", Promise)
], MobileUploadController.prototype, "receive", null);
exports.MobileUploadController = MobileUploadController = __decorate([
    (0, common_1.Controller)('mobile-upload'),
    __metadata("design:paramtypes", [mobile_upload_service_1.MobileUploadService])
], MobileUploadController);
//# sourceMappingURL=mobile-upload.controller.js.map