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
exports.MembershipController = void 0;
const common_1 = require("@nestjs/common");
const common_2 = require("@nestjs/common");
const class_validator_1 = require("class-validator");
const jwt_auth_guard_1 = require("../common/jwt-auth.guard");
const current_user_decorator_1 = require("../common/current-user.decorator");
const membership_service_1 = require("./membership.service");
/**
 * 开通 / 续期会员。
 *
 * `orderId` **必填**: 会员与月度积分是花钱买的权益, 只能由「已支付且未兑换」的
 * 订单触发。此前它是可选的, 于是任何登录用户调一次接口就能白拿会员。
 * 正常流程是先 `POST /orders { membershipPlanId }` 再支付, 支付成功时
 * `OrderService` 会自动激活 —— 前端一般**不需要**主动调这个接口。
 */
class SubscribeDto {
}
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)({ message: '请选择会员套餐' }),
    __metadata("design:type", String)
], SubscribeDto.prototype, "planId", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)({ message: '缺少已支付订单, 不能开通会员' }),
    __metadata("design:type", String)
], SubscribeDto.prototype, "orderId", void 0);
/**
 * C 端会员接口。
 *
 * ⚠ 守卫挂在**方法**上而不是类上：`plans` 必须公开免登录。类级
 * `@UseGuards` 会让访客拿不到价目，首页订阅区与结算页直接失败 ——
 * 而「没登录也要能看价目」是购买链路的第一环。
 */
let MembershipController = class MembershipController {
    constructor(membership) {
        this.membership = membership;
    }
    /** 套餐列表。公开可读 —— 未登录也要能看价目 */
    plans() {
        return this.membership.listPlans();
    }
    /**
     * 单个套餐（含已下架）。
     *
     * 续付会员订单时，套餐可能已从公开列表下架；订单仍在有效期内就应可支付。
     * 需要登录，避免把下架套餐当公开商品继续售卖。
     */
    plan(id) {
        return this.membership.planById(id);
    }
    /** 我的会员详情 */
    me(user) {
        return this.membership.detailOf(user.id);
    }
    /** 开通/ 续期 */
    subscribe(user, dto) {
        return this.membership.subscribe({
            userId: user.id,
            planId: dto.planId,
            orderId: dto.orderId,
        });
    }
    /** 取消订阅。权益保留到当前周期结束 */
    cancel(user) {
        return this.membership.cancel(user.id);
    }
};
exports.MembershipController = MembershipController;
__decorate([
    (0, common_1.Get)('plans'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], MembershipController.prototype, "plans", null);
__decorate([
    (0, common_1.Get)('plans/:id'),
    (0, common_2.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], MembershipController.prototype, "plan", null);
__decorate([
    (0, common_1.Get)('me'),
    (0, common_2.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], MembershipController.prototype, "me", null);
__decorate([
    (0, common_1.Post)('subscribe'),
    (0, common_2.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, SubscribeDto]),
    __metadata("design:returntype", void 0)
], MembershipController.prototype, "subscribe", null);
__decorate([
    (0, common_1.Post)('cancel'),
    (0, common_2.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], MembershipController.prototype, "cancel", null);
exports.MembershipController = MembershipController = __decorate([
    (0, common_1.Controller)('membership'),
    __metadata("design:paramtypes", [membership_service_1.MembershipService])
], MembershipController);
//# sourceMappingURL=membership.controller.js.map