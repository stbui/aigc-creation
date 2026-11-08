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
exports.MarketingMeController = exports.MarketingPublicController = exports.QuoteDto = void 0;
const common_1 = require("@nestjs/common");
const common_2 = require("@nestjs/common");
const class_validator_1 = require("class-validator");
const jwt_auth_guard_1 = require("../common/jwt-auth.guard");
const optional_jwt_auth_guard_1 = require("../common/optional-jwt-auth.guard");
const current_user_decorator_1 = require("../common/current-user.decorator");
const marketing_service_1 = require("./marketing.service");
const membership_service_1 = require("../membership/membership.service");
/** 邀请链接带参: /?inv=CODE */
class InviteBindDto {
}
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(24),
    __metadata("design:type", String)
], InviteBindDto.prototype, "inviteCode", void 0);
/** 结算试算入参。商品明细以服务端为准, 这里只传 id 与数量 */
class QuoteDto {
}
exports.QuoteDto = QuoteDto;
__decorate([
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.ArrayMaxSize)(50),
    (0, class_validator_1.IsString)({ each: true }),
    __metadata("design:type", Array)
], QuoteDto.prototype, "productIds", void 0);
__decorate([
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.ArrayMaxSize)(50),
    (0, class_validator_1.IsInt)({ each: true }),
    (0, class_validator_1.Min)(1, { each: true }),
    __metadata("design:type", Array)
], QuoteDto.prototype, "quantities", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(24),
    __metadata("design:type", String)
], QuoteDto.prototype, "couponCode", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.ArrayMaxSize)(20),
    (0, class_validator_1.IsString)({ each: true }),
    __metadata("design:type", Array)
], QuoteDto.prototype, "campaignIds", void 0);
/**
 * C 端营销接口 (M11)。
 *
 * 与 admin 端的边界: 这里只暴露**读与自助领取**, 绝不含任何配置能力 ——
 * 用户能改自己的签到与邀请记录是正常的, 用户能改券规则则是漏洞。
 */
let MarketingPublicController = class MarketingPublicController {
    constructor(marketing) {
        this.marketing = marketing;
    }
    /**
     * 弹窗活动位 (匿名可访问)。
     *
     * 匿名也要展示是刻意的: 落地页/工作台的促销位必须在未登录时可见, 否则首屏
     * 最大的一块转化位对全部新访客失效。带 token 时才做人群定向 (如仅新用户)。
     *
     * 用 `@Req()` 而非 `@CurrentUser()`: 公开端点没有守卫保证 user 存在,
     * CurrentUser 的返回类型标注为必选, 拿它写可选身份就是在骗类型检查。
     */
    popup(req) {
        return this.marketing.activePopupCampaign(req.user?.id);
    }
    /**
     * 进行中的限时活动（落地页「限时活动」页签）。
     *
     * 匿名可访问：促销信息本身不是隐私，而且这是首屏转化位。只读、无身份维度，
     * 因此不需要 OptionalJwtAuthGuard 之外的任何判断。
     */
    campaigns() {
        return this.marketing.activeCampaigns();
    }
};
exports.MarketingPublicController = MarketingPublicController;
__decorate([
    (0, common_1.Get)('popup'),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], MarketingPublicController.prototype, "popup", null);
__decorate([
    (0, common_1.Get)('campaigns'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], MarketingPublicController.prototype, "campaigns", null);
exports.MarketingPublicController = MarketingPublicController = __decorate([
    (0, common_1.Controller)('marketing'),
    (0, common_2.UseGuards)(optional_jwt_auth_guard_1.OptionalJwtAuthGuard),
    __metadata("design:paramtypes", [marketing_service_1.MarketingService])
], MarketingPublicController);
/**
 * 需要登录的 C 端营销接口。
 */
let MarketingMeController = class MarketingMeController {
    constructor(marketing, membership) {
        this.marketing = marketing;
        this.membership = membership;
    }
    /** 我的邀请码与邀请数据（limit/offset 分页） */
    myInvites(user, limit, offset) {
        const n = Number(limit ?? 20);
        const skip = Number(offset ?? 0);
        return this.marketing.myInvites(user.id, {
            limit: Number.isFinite(n) ? n : 20,
            offset: Number.isFinite(skip) ? skip : 0,
        });
    }
    /**
     * 绑定邀请关系。
     *
     * 由前端在注册成功后调用。**必须晚于注册**: 注册时用户还不存在,
     * 无法建立外键关系。
     */
    bind(user, dto) {
        return this.marketing.bindInvite({ inviteCode: dto.inviteCode, inviteeId: user.id });
    }
    /** 签到状态 (今日是否已签 / 连签天数 / 未来 7 天可得) */
    checkinStatus(user) {
        return this.marketing.checkinStatus(user.id);
    }
    /** 每日签到。重复调用幂等返回已签结果, 不重复发积分 */
    checkin(user) {
        return this.marketing.checkin(user.id);
    }
    /**
     * 结算试算: 返回原价、可用券列表、命中活动与最终优惠。
     *
     * 独立于下单接口的原因: 用户在结算页需要**先看优惠再决定是否下单**,
     * 而下单会创建订单 (占用幂等键且 30 分钟后超时关闭)。
     * 试算不落库, 幂等, 可反复调。
     *
     * ⚠ 商品价格**从服务端读取**, 不接受客户端传入的价格:
     * 接受客户端价格等于把定价权交给前端, 改个请求就能 1 分钱买走全站商品。
     */
    async quote(user, dto) {
        if (!dto.productIds?.length) {
            return {
                subtotalCents: 0,
                memberDiscountCents: 0,
                discountCents: 0,
                payableCents: 0,
                appliedSource: null,
                appliedCouponCode: null,
                appliedCampaignId: null,
                notStackedNotice: null,
                coupons: [],
                items: [],
            };
        }
        const snapshot = await this.marketing.quoteItems(dto.productIds);
        const items = dto.productIds.map((id, i) => {
            const p = snapshot.get(id);
            return {
                productId: id,
                name: p?.name ?? '',
                priceCents: p?.priceCents ?? 0,
                credits: p?.credits ?? 0,
                quantity: dto.quantities?.[i] ?? 1,
                available: Boolean(p) && p.status === 'active',
            };
        });
        const validItems = items
            .filter((i) => i.available)
            .map(({ productId, priceCents, quantity }) => ({ productId, priceCents, quantity }));
        const subtotalCents = validItems.reduce((s, i) => s + i.priceCents * i.quantity, 0);
        /*
         * 会员加油包折扣必须进入试算。
         *
         * 下单链路 (OrdersService.create) 先执行 membership.quoteOrder, 再叠加
         * 券/活动; 试算如果只算券, 会员看到的"应付金额"会比实际扣款高,
         * 下单后金额突然变小。这里与下单保持同一顺序, 并单独返回会员优惠金额,
         * 让前端能逐行解释"原价 - 会员优惠 - 券优惠 = 应付"。
         */
        const memberQuote = await this.membership.quoteOrder(user.id, subtotalCents, {
            isSubscription: false,
        });
        const memberDiscountCents = Math.max(0, subtotalCents - memberQuote.finalCents);
        const afterMemberCents = memberQuote.finalCents;
        const discount = await this.marketing.settleDiscount({
            userId: user.id,
            items: validItems,
            couponCode: dto.couponCode ?? null,
            campaignIds: dto.campaignIds,
        });
        const couponDiscountCents = Math.min(discount.discountCents, afterMemberCents);
        const coupons = await this.marketing.previewCoupons({ userId: user.id, items: validItems });
        return {
            subtotalCents,
            /** 会员加油包折扣（非会员为 0） */
            memberDiscountCents,
            /** 券 / 限时活动优惠（不含会员折扣） */
            discountCents: couponDiscountCents,
            payableCents: Math.max(0, afterMemberCents - couponDiscountCents),
            // 明确告知取的是哪一个优惠, 以及另一个被放弃了 —— 用户自己能核对
            appliedSource: discount.source,
            appliedCouponCode: discount.couponCode,
            appliedCampaignId: discount.campaignId,
            notStackedNotice: discount.snapshot?.notStacked
                ? '优惠券与限时活动不叠加, 已自动取优惠金额更高的一项'
                : null,
            coupons,
            items,
        };
    }
};
exports.MarketingMeController = MarketingMeController;
__decorate([
    (0, common_1.Get)('invites'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Query)('limit')),
    __param(2, (0, common_1.Query)('offset')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], MarketingMeController.prototype, "myInvites", null);
__decorate([
    (0, common_1.Post)('invites/bind'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, InviteBindDto]),
    __metadata("design:returntype", void 0)
], MarketingMeController.prototype, "bind", null);
__decorate([
    (0, common_1.Get)('checkin'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], MarketingMeController.prototype, "checkinStatus", null);
__decorate([
    (0, common_1.Post)('checkin'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], MarketingMeController.prototype, "checkin", null);
__decorate([
    (0, common_1.Post)('quote'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, QuoteDto]),
    __metadata("design:returntype", Promise)
], MarketingMeController.prototype, "quote", null);
exports.MarketingMeController = MarketingMeController = __decorate([
    (0, common_1.Controller)('marketing'),
    (0, common_2.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __metadata("design:paramtypes", [marketing_service_1.MarketingService,
        membership_service_1.MembershipService])
], MarketingMeController);
//# sourceMappingURL=marketing.controller.js.map