"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChannelsModule = void 0;
/**
 * 外部消息通道模块（邮件 / 短信）。
 *
 * 设为 `@Global()` 的原因与 LoggerModule 相同：通道是**基础设施**，
 * 任何业务模块（认证、会员到期、订单通知）都可能发消息，逐个 import
 * 只会制造样板与循环依赖风险。模块自身只依赖 ConfigService，无业务耦合。
 */
const common_1 = require("@nestjs/common");
const email_service_1 = require("./email/email.service");
const sms_service_1 = require("./sms/sms.service");
let ChannelsModule = class ChannelsModule {
};
exports.ChannelsModule = ChannelsModule;
exports.ChannelsModule = ChannelsModule = __decorate([
    (0, common_1.Global)(),
    (0, common_1.Module)({
        providers: [email_service_1.EmailService, sms_service_1.SmsService],
        exports: [email_service_1.EmailService, sms_service_1.SmsService],
    })
], ChannelsModule);
//# sourceMappingURL=channels.module.js.map