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
exports.OrderCancelController = exports.PaymentsController = exports.CreateIntentDto = void 0;
exports.normalizeClientIp = normalizeClientIp;
const common_1 = require("@nestjs/common");
const class_validator_1 = require("class-validator");
const node_net_1 = require("node:net");
const jwt_auth_guard_1 = require("../common/jwt-auth.guard");
const current_user_decorator_1 = require("../common/current-user.decorator");
const app_exception_1 = require("../common/app.exception");
const settings_service_1 = require("../common/settings.service");
const payment_order_service_1 = require("./payment-order.service");
const payment_config_service_1 = require("./payment-config.service");
const payment_notification_service_1 = require("./payment-notification.service");
const adapters_1 = require("./adapters");
const types_1 = require("./adapters/types");
class CreateIntentDto {
}
exports.CreateIntentDto = CreateIntentDto;
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(32),
    __metadata("design:type", String)
], CreateIntentDto.prototype, "providerId", void 0);
/**
 * C 端支付接口。
 *
 * `/payments/callback/:providerId/:configId` 是**公开**路由 —— 渠道服务器不带
 * 我们的 JWT，身份靠验签证明。它绝不能挂 JwtAuthGuard，也不能依赖「谁能调通」
 * 判断请求是否可信。
 */
let PaymentsController = class PaymentsController {
    constructor(orders, configs, notifications, settings) {
        this.orders = orders;
        this.configs = configs;
        this.notifications = notifications;
        this.settings = settings;
    }
    /**
     * C 端支付设置：默认币种 + 该币种下可用渠道。
     *
     * 公开接口：商品页/结算页在登录前就要按默认币种排序与过滤。
     * 不返回任何凭据；渠道字段由 PaymentConfigService 的公开视图裁剪。
     */
    async settingsView() {
        const currency = await this.settings.get('payment.defaultCurrency');
        const target = this.normalizeCurrency(String(currency || 'CNY'));
        const providers = await this.configs.available(target);
        return { defaultCurrency: target, providers };
    }
    /** 可选支付渠道（按订单币种或指定币种过滤） */
    async providers(currency) {
        const target = this.normalizeCurrency(currency);
        const items = await this.configs.available(target);
        return { items, total: items.length, page: 1, pageSize: items.length };
    }
    /** 发起支付：返回跳转地址或二维码内容 */
    createIntent(orderId, user, dto, req) {
        return this.orders.createIntent({
            orderId,
            userId: user.id,
            providerId: dto.providerId,
            clientIp: normalizeClientIp(req.ip || req.socket?.remoteAddress),
        });
    }
    /** 支付状态轮询 */
    status(orderId, user) {
        return this.orders.query({ orderId, actor: { kind: 'user', userId: user.id } });
    }
    /** 主动查单（刷新动作，不是状态变更） */
    query(orderId, user) {
        return this.orders.query({
            orderId,
            actor: { kind: 'user', userId: user.id },
            force: true,
        });
    }
    /**
     * 渠道异步回调。
     *
     * 必须用**原始报文**验签（微信签名覆盖 body 字节；支付宝表单参数经 URL
     * 解码后拼串），故 main.ts 建应用时开启了 `rawBody: true`。
     *
     * 响应格式由通道决定（支付宝纯文本 / 微信 JSON），用 @Res 直接写，
     * 不经过统一响应信封 —— 渠道不认识 `{code,data,message}`。
     */
    async callbackGet(providerId, configId, query, req, res) {
        const body = query ?? {};
        await this.handleCallback(providerId, configId, req.headers, Buffer.from(JSON.stringify(body)), body, res);
    }
    async callbackPost(providerId, configId, req, body, res) {
        const rawBody = req.rawBody
            ? req.rawBody
            : Buffer.from(typeof body === 'object' && body !== null ? JSON.stringify(body) : '');
        await this.handleCallback(providerId, configId, req.headers, rawBody, body ?? {}, res);
    }
    async handleCallback(providerId, configId, headers, rawBody, body, res) {
        if (!(0, adapters_1.getAdapter)(providerId)) {
            throw new app_exception_1.AppError(40400, `未知支付渠道: ${providerId}`, 404);
        }
        const ack = await this.notifications.ingest({
            providerId: providerId,
            configId,
            headers,
            rawBody,
            body,
        });
        res.status(ack.status);
        res.setHeader('Content-Type', ack.contentType);
        res.send(ack.body);
    }
    normalizeCurrency(currency) {
        if (!currency)
            return 'CNY';
        if (!types_1.PAYMENT_CURRENCIES.includes(currency)) {
            throw new app_exception_1.AppError(40001, `不支持的币种: ${currency}`, 400);
        }
        return currency;
    }
};
exports.PaymentsController = PaymentsController;
__decorate([
    (0, common_1.Get)('settings'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], PaymentsController.prototype, "settingsView", null);
__decorate([
    (0, common_1.Get)('providers'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __param(0, (0, common_1.Query)('currency')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], PaymentsController.prototype, "providers", null);
__decorate([
    (0, common_1.Post)(':orderId/intent'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __param(0, (0, common_1.Param)('orderId')),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __param(2, (0, common_1.Body)()),
    __param(3, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, CreateIntentDto, Object]),
    __metadata("design:returntype", void 0)
], PaymentsController.prototype, "createIntent", null);
__decorate([
    (0, common_1.Get)(':orderId/status'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __param(0, (0, common_1.Param)('orderId')),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], PaymentsController.prototype, "status", null);
__decorate([
    (0, common_1.Post)(':orderId/query'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __param(0, (0, common_1.Param)('orderId')),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], PaymentsController.prototype, "query", null);
__decorate([
    (0, common_1.Get)('callback/:providerId/:configId'),
    __param(0, (0, common_1.Param)('providerId')),
    __param(1, (0, common_1.Param)('configId')),
    __param(2, (0, common_1.Query)()),
    __param(3, (0, common_1.Req)()),
    __param(4, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, Object, Object, Object]),
    __metadata("design:returntype", Promise)
], PaymentsController.prototype, "callbackGet", null);
__decorate([
    (0, common_1.Post)('callback/:providerId/:configId'),
    __param(0, (0, common_1.Param)('providerId')),
    __param(1, (0, common_1.Param)('configId')),
    __param(2, (0, common_1.Req)()),
    __param(3, (0, common_1.Body)()),
    __param(4, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, Object, Object, Object]),
    __metadata("design:returntype", Promise)
], PaymentsController.prototype, "callbackPost", null);
exports.PaymentsController = PaymentsController = __decorate([
    (0, common_1.Controller)('payments'),
    __metadata("design:paramtypes", [payment_order_service_1.PaymentOrderService,
        payment_config_service_1.PaymentConfigService,
        payment_notification_service_1.PaymentNotificationService,
        settings_service_1.SettingsService])
], PaymentsController);
/** ZPay 要求 clientip 必须来自服务端可验证的请求上下文，不能信任请求体。 */
function normalizeClientIp(raw) {
    const value = raw?.trim();
    if (!value)
        return undefined;
    const candidate = value.startsWith('::ffff:') ? value.slice(7) : value;
    return (0, node_net_1.isIP)(candidate) ? candidate : undefined;
}
/**
 * 用户取消未支付订单。
 *
 * 独立成 controller 而不是塞回 `OrdersController`：取消订单现在必须**先向
 * 渠道查单**（渠道可能已经收了钱），这条链路依赖支付域；让订单域反向依赖
 * 支付域会形成循环。路由仍是 `POST /orders/:id/cancel`，对前端无感。
 */
let OrderCancelController = class OrderCancelController {
    constructor(orders) {
        this.orders = orders;
    }
    cancel(id, user) {
        return this.orders.close({ orderId: id, actor: { kind: 'user', userId: user.id } });
    }
};
exports.OrderCancelController = OrderCancelController;
__decorate([
    (0, common_1.Post)(':id/cancel'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], OrderCancelController.prototype, "cancel", null);
exports.OrderCancelController = OrderCancelController = __decorate([
    (0, common_1.Controller)('orders'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __metadata("design:paramtypes", [payment_order_service_1.PaymentOrderService])
], OrderCancelController);
//# sourceMappingURL=payments.controller.js.map