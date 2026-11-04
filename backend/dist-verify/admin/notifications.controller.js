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
exports.AdminNotificationsController = void 0;
const common_1 = require("@nestjs/common");
const class_validator_1 = require("class-validator");
const admin_decorator_1 = require("./admin.decorator");
const permissions_1 = require("./permissions");
const notifications_service_1 = require("../notifications/notifications.service");
const email_service_1 = require("../channels/email/email.service");
const sms_service_1 = require("../channels/sms/sms.service");
class BroadcastDto {
}
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)({ message: '请填写公告标题' }),
    (0, class_validator_1.MaxLength)(80),
    __metadata("design:type", String)
], BroadcastDto.prototype, "title", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)({ message: '请填写公告正文' }),
    (0, class_validator_1.MaxLength)(2000),
    __metadata("design:type", String)
], BroadcastDto.prototype, "body", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(200),
    __metadata("design:type", String)
], BroadcastDto.prototype, "link", void 0);
class UpsertTemplateDto {
}
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)({ message: '请填写模板编码' }),
    (0, class_validator_1.MaxLength)(60),
    __metadata("design:type", String)
], UpsertTemplateDto.prototype, "code", void 0);
__decorate([
    (0, class_validator_1.IsIn)(['inapp', 'email', 'sms'], { message: '未知的通道' }),
    __metadata("design:type", String)
], UpsertTemplateDto.prototype, "channel", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(120),
    __metadata("design:type", String)
], UpsertTemplateDto.prototype, "subject", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)({ message: '请填写模板正文' }),
    (0, class_validator_1.MaxLength)(2000),
    __metadata("design:type", String)
], UpsertTemplateDto.prototype, "body", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], UpsertTemplateDto.prototype, "enabled", void 0);
/**
 * 后台站内消息：全站广播 + 模板管理。
 *
 * 广播是**不可撤回**的写扩散（每个活跃用户一行），因此要审计；
 * 模板改动影响所有后续通知，同样审计。
 */
let AdminNotificationsController = class AdminNotificationsController {
    constructor(notifications, email, sms) {
        this.notifications = notifications;
        this.email = email;
        this.sms = sms;
    }
    /**
     * 邮件 / 短信通道的真实生效状态。
     *
     * 这两个通道「填了真实 provider 但缺凭据」时会**静默回落 console**（告警在
     * 启动日志里，跑起来之后没人再看）。没有这条只读接口，运营无法判断一封
     * 验证码邮件是不是真的发出去了 —— 页面只能猜。
     *
     * 只回 provider / delivers / configured 与展示用的发信地址或签名，
     * **不含任何凭据**。
     */
    channels() {
        return { email: this.email.status(), sms: this.sms.status() };
    }
    broadcast(dto) {
        return this.notifications.broadcast(dto.title, dto.body, dto.link);
    }
    templates() {
        return this.notifications.templates();
    }
    upsertTemplate(dto) {
        return this.notifications.upsertTemplate(dto);
    }
};
exports.AdminNotificationsController = AdminNotificationsController;
__decorate([
    (0, common_1.Get)('channels'),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.messageWrite),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], AdminNotificationsController.prototype, "channels", null);
__decorate([
    (0, common_1.Post)('broadcast'),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.messageWrite),
    (0, admin_decorator_1.AuditAction)('notification.broadcast'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [BroadcastDto]),
    __metadata("design:returntype", void 0)
], AdminNotificationsController.prototype, "broadcast", null);
__decorate([
    (0, common_1.Get)('templates'),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.messageWrite),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], AdminNotificationsController.prototype, "templates", null);
__decorate([
    (0, common_1.Post)('templates'),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.messageWrite),
    (0, admin_decorator_1.AuditAction)('notification.template'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [UpsertTemplateDto]),
    __metadata("design:returntype", void 0)
], AdminNotificationsController.prototype, "upsertTemplate", null);
exports.AdminNotificationsController = AdminNotificationsController = __decorate([
    (0, common_1.Controller)('admin/notifications'),
    __metadata("design:paramtypes", [notifications_service_1.NotificationsService,
        email_service_1.EmailService,
        sms_service_1.SmsService])
], AdminNotificationsController);
//# sourceMappingURL=notifications.controller.js.map