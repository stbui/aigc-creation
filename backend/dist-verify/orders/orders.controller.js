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
exports.OrdersController = exports.SandboxPayDto = exports.CreateOrderDto = void 0;
const common_1 = require("@nestjs/common");
const common_2 = require("@nestjs/common");
const class_validator_1 = require("class-validator");
const jwt_auth_guard_1 = require("../common/jwt-auth.guard");
const current_user_decorator_1 = require("../common/current-user.decorator");
const app_exception_1 = require("../common/app.exception");
const order_service_1 = require("./order.service");
/**
 * 下单入参。
 *
 * `productId` 与 `membershipPlanId` **二选一** (服务层强校验, 不靠前端):
 *   - productId        → 积分包/套餐商品, 走 OrderItem 快照与积分发放
 *   - membershipPlanId → 会员订阅, 金额取套餐价, 支付成功后激活会员
 *
 * 为什么不做成"商品表里加一类会员商品": 会员是**权益**而非一次性积分,
 * 它的金额、周期、发放时机都与商品不同, 混进 Product 会让
 * 「买完发多少积分」这条规则出现两套真相。
 */
class CreateOrderDto {
}
exports.CreateOrderDto = CreateOrderDto;
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(64),
    __metadata("design:type", String)
], CreateOrderDto.prototype, "idempotencyKey", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CreateOrderDto.prototype, "productId", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    __metadata("design:type", Number)
], CreateOrderDto.prototype, "quantity", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CreateOrderDto.prototype, "membershipPlanId", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(24),
    __metadata("design:type", String)
], CreateOrderDto.prototype, "couponCode", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.ArrayMaxSize)(20),
    (0, class_validator_1.IsString)({ each: true }),
    __metadata("design:type", Array)
], CreateOrderDto.prototype, "campaignIds", void 0);
class SandboxPayDto {
}
exports.SandboxPayDto = SandboxPayDto;
__decorate([
    (0, class_validator_1.IsIn)(['success', 'failed', 'timeout'], { message: '沙箱场景非法' }),
    __metadata("design:type", String)
], SandboxPayDto.prototype, "scenario", void 0);
/**
 * C 端订单接口。
 *
 * 订单归属当前用户, 任何跨用户访问返回 403 —— 不靠前端隐藏。
 */
let OrdersController = class OrdersController {
    constructor(orders) {
        this.orders = orders;
    }
    /** 幂等下单。券与活动不叠加, 取更优者 (admin-detailed-design.md §12.6) */
    create(user, dto) {
        if (!dto.productId && !dto.membershipPlanId) {
            throw new app_exception_1.AppError(40001, '请选择积分商品或会员套餐', 400);
        }
        // 二选一必须是真互斥: 否则会员单会静默丢掉 productId, 用户以为两样都买了
        if (dto.productId && dto.membershipPlanId) {
            throw new app_exception_1.AppError(40001, '会员套餐与积分商品不能混在同一订单中购买', 400);
        }
        return this.orders.create({
            userId: user.id,
            idempotencyKey: dto.idempotencyKey,
            ...(dto.membershipPlanId
                ? { membershipPlanId: dto.membershipPlanId }
                : { items: [{ productId: dto.productId, quantity: dto.quantity ?? 1 }] }),
            couponCode: dto.couponCode ?? null,
            campaignIds: dto.campaignIds,
        });
    }
    /** 我的订单（limit/offset 分页，返回 total 与各状态计数） */
    list(user, limit, offset) {
        const n = Number(limit ?? 20);
        const skip = Number(offset ?? 0);
        return this.orders.listByUser(user.id, Number.isFinite(n) ? Math.min(n, 100) : 20, Number.isFinite(skip) ? Math.max(skip, 0) : 0);
    }
    detail(id, user) {
        return this.orders.detail(id, user.id);
    }
    /**
     * 沙箱支付 (M8)。
     *
     * 前端据scenario 决定演示哪种结果: 成功 / 失败 / 超时。
     * 真实通道 (M15) 上线后此端点废弃, 改走渠道回调。
     */
    pay(id, user, dto) {
        return this.orders.sandboxPay({ orderId: id, userId: user.id, scenario: dto.scenario });
    }
};
exports.OrdersController = OrdersController;
__decorate([
    (0, common_1.Post)(),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, CreateOrderDto]),
    __metadata("design:returntype", void 0)
], OrdersController.prototype, "create", null);
__decorate([
    (0, common_1.Get)(),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Query)('limit')),
    __param(2, (0, common_1.Query)('offset')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], OrdersController.prototype, "list", null);
__decorate([
    (0, common_1.Get)(':id'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], OrdersController.prototype, "detail", null);
__decorate([
    (0, common_1.Post)(':id/pay'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, SandboxPayDto]),
    __metadata("design:returntype", void 0)
], OrdersController.prototype, "pay", null);
exports.OrdersController = OrdersController = __decorate([
    (0, common_1.Controller)('orders'),
    (0, common_2.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __metadata("design:paramtypes", [order_service_1.OrderService])
], OrdersController);
//# sourceMappingURL=orders.controller.js.map