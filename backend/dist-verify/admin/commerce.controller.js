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
exports.AdminCommerceController = exports.CreditImportDto = exports.OrderBatchDto = exports.UpdateCreditPricesDto = exports.CreditPriceItemDto = exports.BatchAdjustDto = exports.BatchAdjustItemDto = exports.AdjustCreditDto = exports.RefundDto = exports.ProductUpdateDto = exports.ProductCreateDto = exports.ProductStatusDto = void 0;
const common_1 = require("@nestjs/common");
const platform_express_1 = require("@nestjs/platform-express");
const multer_1 = require("multer");
const class_validator_1 = require("class-validator");
const class_transformer_1 = require("class-transformer");
const admin_decorator_1 = require("./admin.decorator");
const app_exception_1 = require("../common/app.exception");
const order_service_1 = require("../orders/order.service");
const credit_service_1 = require("../credits/credit.service");
const credit_price_service_1 = require("../credits/credit-price.service");
const commerce_admin_service_1 = require("./commerce-admin.service");
const settings_service_1 = require("./settings.service");
const permissions_1 = require("./permissions");
const csv_response_1 = require("../common/csv-response");
/** 商品上/下架 */
class ProductStatusDto {
}
exports.ProductStatusDto = ProductStatusDto;
__decorate([
    (0, class_validator_1.IsIn)(["active", "offline"]),
    __metadata("design:type", String)
], ProductStatusDto.prototype, "status", void 0);
/** 新建商品 */
class ProductCreateDto {
}
exports.ProductCreateDto = ProductCreateDto;
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(40),
    __metadata("design:type", String)
], ProductCreateDto.prototype, "sku", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(80),
    __metadata("design:type", String)
], ProductCreateDto.prototype, "name", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(500),
    __metadata("design:type", String)
], ProductCreateDto.prototype, "description", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(20),
    __metadata("design:type", String)
], ProductCreateDto.prototype, "type", void 0);
__decorate([
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(0),
    __metadata("design:type", Number)
], ProductCreateDto.prototype, "priceCents", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(0),
    __metadata("design:type", Number)
], ProductCreateDto.prototype, "originalPriceCents", void 0);
__decorate([
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(0),
    __metadata("design:type", Number)
], ProductCreateDto.prototype, "credits", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(0),
    __metadata("design:type", Number)
], ProductCreateDto.prototype, "creditsValidDays", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsIn)(["immediate", "manual"]),
    __metadata("design:type", String)
], ProductCreateDto.prototype, "grantType", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsIn)(["active", "offline"]),
    __metadata("design:type", String)
], ProductCreateDto.prototype, "status", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsInt)(),
    __metadata("design:type", Number)
], ProductCreateDto.prototype, "sortOrder", void 0);
/** 修改商品。sku 不可改, 故不在此列 */
class ProductUpdateDto {
}
exports.ProductUpdateDto = ProductUpdateDto;
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(80),
    __metadata("design:type", String)
], ProductUpdateDto.prototype, "name", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(500),
    __metadata("design:type", String)
], ProductUpdateDto.prototype, "description", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(0),
    __metadata("design:type", Number)
], ProductUpdateDto.prototype, "priceCents", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(0),
    __metadata("design:type", Number)
], ProductUpdateDto.prototype, "originalPriceCents", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(0),
    __metadata("design:type", Number)
], ProductUpdateDto.prototype, "credits", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(0),
    __metadata("design:type", Number)
], ProductUpdateDto.prototype, "creditsValidDays", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsIn)(["immediate", "manual"]),
    __metadata("design:type", String)
], ProductUpdateDto.prototype, "grantType", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsIn)(["active", "offline"]),
    __metadata("design:type", String)
], ProductUpdateDto.prototype, "status", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsInt)(),
    __metadata("design:type", Number)
], ProductUpdateDto.prototype, "sortOrder", void 0);
/** 退款 */
class RefundDto {
}
exports.RefundDto = RefundDto;
__decorate([
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    __metadata("design:type", Number)
], RefundDto.prototype, "amountCents", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(200),
    __metadata("design:type", String)
], RefundDto.prototype, "reason", void 0);
/**
 * 人工调整积分 (B-52)。
 *
 * 字段名用 **delta** 而非 amount —— delta 明确表达「有正负的变动量」,
 * amount 会被误解为「金额」或「绝对值」, 后者会让"扣减"无法表达。
 *
 * `reason` **必填**：积分是用户资产，账本必须能回答「为什么给他加 100」，
 * 只写「人工调整用户积分」这种固定文案等于没有原因。
 */
class AdjustCreditDto {
}
exports.AdjustCreditDto = AdjustCreditDto;
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], AdjustCreditDto.prototype, "userId", void 0);
__decorate([
    (0, class_validator_1.IsInt)(),
    __metadata("design:type", Number)
], AdjustCreditDto.prototype, "delta", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(200),
    __metadata("design:type", String)
], AdjustCreditDto.prototype, "reason", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(0),
    __metadata("design:type", Number)
], AdjustCreditDto.prototype, "validDays", void 0);
/**
 * 批量调整积分。
 *
 * 上限 100 条: 再大应走导入任务, 而不是一个可能超时 30s 的同步请求。
 *
 * `reason` 整批共用；逐条可再带 `reason` 覆盖（批量里往往有个别「特殊补偿」）。
 */
class BatchAdjustItemDto {
}
exports.BatchAdjustItemDto = BatchAdjustItemDto;
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], BatchAdjustItemDto.prototype, "userId", void 0);
__decorate([
    (0, class_validator_1.IsInt)(),
    __metadata("design:type", Number)
], BatchAdjustItemDto.prototype, "delta", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(200),
    __metadata("design:type", String)
], BatchAdjustItemDto.prototype, "reason", void 0);
class BatchAdjustDto {
}
exports.BatchAdjustDto = BatchAdjustDto;
__decorate([
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.ArrayMaxSize)(100, { message: "单次批量调整最多 100 条" }),
    (0, class_validator_1.ValidateNested)({ each: true }),
    (0, class_transformer_1.Type)(() => BatchAdjustItemDto),
    __metadata("design:type", Array)
], BatchAdjustDto.prototype, "items", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(200),
    __metadata("design:type", String)
], BatchAdjustDto.prototype, "reason", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(80),
    __metadata("design:type", String)
], BatchAdjustDto.prototype, "idempotencyKey", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(0),
    __metadata("design:type", Number)
], BatchAdjustDto.prototype, "validDays", void 0);
/** 单项消耗价 */
class CreditPriceItemDto {
}
exports.CreditPriceItemDto = CreditPriceItemDto;
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(40),
    __metadata("design:type", String)
], CreditPriceItemDto.prototype, "capabilityId", void 0);
__decorate([
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(0),
    (0, class_validator_1.Max)(10000),
    __metadata("design:type", Number)
], CreditPriceItemDto.prototype, "cost", void 0);
/**
 * 批量改价 (commerce-design.md §8.2 `PUT /admin/credit-prices`)。
 *
 * 数组而非对象: class-validator 的属性名不能带点号, 消耗价的 key 是
 * `creditPrice.<capabilityId>` 这种动态形式, 走扁平 DTO 表达不了。
 */
class UpdateCreditPricesDto {
}
exports.UpdateCreditPricesDto = UpdateCreditPricesDto;
__decorate([
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.ArrayMaxSize)(50),
    __metadata("design:type", Array)
], UpdateCreditPricesDto.prototype, "items", void 0);
/** 批量核销订单。 */
class OrderBatchDto {
}
exports.OrderBatchDto = OrderBatchDto;
__decorate([
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.ArrayMaxSize)(100, { message: "单次批量最多 100 条" }),
    (0, class_validator_1.IsString)({ each: true }),
    __metadata("design:type", Array)
], OrderBatchDto.prototype, "ids", void 0);
__decorate([
    (0, class_validator_1.IsIn)(["mark_paid"], { message: "action 只能是 mark_paid" }),
    __metadata("design:type", String)
], OrderBatchDto.prototype, "action", void 0);
/** 积分 CSV 导入的整批默认值（multipart 文本字段） */
class CreditImportDto {
}
exports.CreditImportDto = CreditImportDto;
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Type)(() => Number),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(0),
    __metadata("design:type", Number)
], CreditImportDto.prototype, "validDays", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(80),
    __metadata("design:type", String)
], CreditImportDto.prototype, "importKey", void 0);
/** 把 query 里的数字安全转成 number; 非法值给 undefined 让 service 用默认值 */
function num(raw) {
    if (raw === undefined || raw === "")
        return undefined;
    const n = Number(raw);
    return Number.isFinite(n) ? n : undefined;
}
/**
 * 交易后台 (admin-prd.md §3.6~3.9)。
 *
 * 权限点分离:
 *   product.read/write  商品
 *   order.read/refund   订单
 *   payment.read        支付流水
 *   credit.read/adjust  积分
 *   data.export         任何 CSV 导出 (导出即把用户数据带出系统)
 *
 * ⚠ 所有写操作都带 @AuditAction —— 交易域的每一次改动都必须可追责。
 * 查询与规则在 AdminCommerceService, 本控制器只做权限/参数/响应。
 */
let AdminCommerceController = class AdminCommerceController {
    constructor(orders, commerce, credit, creditPrice, settings) {
        this.orders = orders;
        this.commerce = commerce;
        this.credit = credit;
        this.creditPrice = creditPrice;
        this.settings = settings;
    }
    // ── 能力消耗价 (commerce-design.md §4.4) ──────────────────────────
    /**
     * 全站能力消耗价。
     *
     * 每项同时返回 `cost`(生效价) / `registryDefault`(代码默认) / `source`,
     * 让运营一眼看出「这个价现在是谁在管」—— 改价页上不标明来源,
     * 就会出现「我改了没生效」时无法判断该改哪一层。
     */
    creditPrices() {
        return this.creditPrice.adminList();
    }
    /**
     * 批量改价。逐项落库并即时失效缓存 —— 改完立刻生效, 不必等 3s TTL。
     *
     * ⚠ 写审计: 定价是影响收入的关键操作, 必须能回答「这个价谁在什么时候改的」。
     */
    async updateCreditPrices(dto) {
        if (!dto.items?.length) {
            throw new app_exception_1.AppError(40001, "没有需要更新的消耗价", 400);
        }
        const updated = [];
        for (const it of dto.items) {
            updated.push(await this.creditPrice.setPrice(it.capabilityId, it.cost));
        }
        return { updated };
    }
    /** 单项回落默认值 (删掉 SystemSetting 覆盖, 回到 registry) */
    resetCreditPrice(capabilityId) {
        return this.creditPrice.resetPrice(capabilityId);
    }
    // ── 商品 (B-34~B-36) ────────────────────────────────────────────
    /** 商品列表 */
    products(status) {
        return this.commerce.listProducts(status);
    }
    /** 新建商品。默认下架, 确认无误后再上架 */
    createProduct(dto) {
        return this.commerce.createProduct(dto);
    }
    /**
     * 修改商品。
     *
     * 改价不影响已生成的订单 —— 订单存的是下单时快照, 这是交易系统的基本约定。
     */
    updateProduct(id, dto) {
        return this.commerce.updateProduct(id, dto);
    }
    /** 上架/ 下架 (B-36)。下架不影响历史订单 */
    async setProductStatus(id, dto) {
        const product = await this.commerce.updateProduct(id, {
            status: dto.status,
        });
        return { id: product.id, status: product.status };
    }
    // ── 订单 (B-39~B-44) ─────────────────────────────────────────────
    /**
     * 订单列表。
     *
     * 支持 orderNo / email / status / channel / 时间范围 过滤:
     * 客服拿着"用户邮箱 + 大概日期"来问，是最高频的排障入口。
     */
    orderList(status, orderNo, email, channel, refundState, from, to, userId, page, pageSize, sort) {
        return this.commerce.listOrders({
            status,
            orderNo,
            email,
            channel,
            refundState,
            from,
            to,
            page: num(page),
            pageSize: num(pageSize),
            sort,
        });
    }
    /**
     * 订单导出 (CSV)。
     *
     * 用 @Res() 直接写响应: 全局 ResponseInterceptor 会把返回值包成
     * `{code,data}` JSON, 那样浏览器拿到的是一个 JSON 字符串而不是可下载的文件。
     */
    async exportOrders(res, status, orderNo, email, channel, refundState, from, to) {
        const csv = await this.commerce.exportOrders({
            status,
            orderNo,
            email,
            channel,
            refundState,
            from,
            to,
        });
        (0, csv_response_1.sendCsv)(res, "orders", csv);
    }
    /** 订单详情 (B-41): 明细 / 支付 / 退款 / 券 / 会员套餐一次取全 */
    orderDetail(id) {
        return this.commerce.orderDetail(id);
    }
    /** 手工核销 (B-42): 标记已支付, 须写审计 */
    async markPaid(id, actor) {
        const order = await this.commerce.orderDetail(id);
        return this.orders.markPaid({
            orderId: id,
            userId: order.userId,
            payTransactionId: `MANUAL-${actor.id}-${Date.now()}`,
            channel: "manual",
        });
    }
    /**
     * 批量核销（B7）。
     *
     * 权限直接用 `order.mark_paid`（本端点只有一个动作，静态装饰器足够）。
     * 逐条返回结果：40 笔里有一笔已退款、两笔已被渠道回调核销，
     * 运营需要知道具体是哪几笔、为什么。
     */
    batchMarkPaid(dto, actor) {
        return this.commerce.batchMarkPaid(dto.ids, actor.id);
    }
    /**
     * 退款 (B-43 + B8 规则): 按批次剩余量扣回。
     *
     * 规则（时间窗 / 可退比例 / 是否允许已消耗积分退款）在提交这一刻从设置里
     * 读出并冻结, 交给 `OrderService.refund` 判定 —— 判定逻辑留在订单域,
     * 这样将来 C 端自助退款接同一套服务时不会漏规则。
     */
    async refund(id, dto, actor) {
        const rules = await this.settings.refundRules();
        return this.orders.refund({
            orderId: id,
            amountCents: dto.amountCents,
            reason: dto.reason,
            operatorId: actor.id,
            rules,
        });
    }
    // ── 支付流水 (B-45) ─────────────────────────────────────────────
    payments(status, pageSize, from, to) {
        return this.commerce.listPayments({
            status,
            pageSize: num(pageSize),
            from,
            to,
        });
    }
    async exportPayments(res, status, from, to) {
        const csv = await this.commerce.exportPayments({ status, from, to });
        (0, csv_response_1.sendCsv)(res, "payments", csv);
    }
    // ── 积分 (B-49~B-52) ────────────────────────────────────────────
    /** 用户积分总览 (B-49) */
    credits(userId, email, page, pageSize) {
        return this.commerce.listCredits({
            userId,
            email,
            page: num(page),
            pageSize: num(pageSize),
        });
    }
    /** 积分总览导出 (CSV) */
    async exportCredits(res, userId, email) {
        const csv = await this.commerce.exportCredits({ userId, email });
        (0, csv_response_1.sendCsv)(res, "credits", csv);
    }
    /**
     * 账实核对：比对「账户可用 + 冻结」与「Σ 批次剩余」。
     *
     * 只读，不修数。积分体系有两条必须相等的余额（账户权威 / 批次权威），
     * 任何一处绕过钱包直接改批次都会让等式破裂，而破裂后**所有扣费都会失败**。
     * 此前只在注释里承诺「每日对账」，实际没有检测入口。
     */
    auditCredits(limit) {
        const n = num(limit);
        return this.credit.auditConsistency(n !== undefined && n > 0 ? Math.min(n, 5000) : 500);
    }
    /** 某用户的批次明细 (B-50) */
    lots(userId, from, to) {
        return this.commerce.creditLots(userId, { from, to });
    }
    /** 某用户的流水 (B-51), 可按类型与时间过滤 */
    ledger(userId, type, from, to, limit) {
        return this.commerce.creditLedger(userId, {
            type,
            from,
            to,
            limit: num(limit),
        });
    }
    /** 人工增减积分 (B-52)。原因必填，直接落进积分流水。 */
    adjust(dto, actor) {
        return this.credit.adminAdjust({
            userId: dto.userId,
            delta: dto.delta,
            reason: dto.reason,
            operatorId: actor.id,
            validDays: dto.validDays,
        });
    }
    /**
     * 批量调整积分。逐条独立执行并回传每条结果。
     *
     * 幂等键按「操作人 + 批次号」生成，由前端在打开抽屉时生成并随提交带上：
     * 超时重试不会二次发放。缺省时服务端生成一次性键（此时重试无保护，
     * 前端不传即等于放弃该保护）。
     */
    batchAdjust(dto, actor) {
        return this.commerce.batchAdjust(dto.items, {
            operatorId: actor.id,
            validDays: dto.validDays,
            reason: dto.reason,
            idempotencyKey: dto.idempotencyKey,
        });
    }
    /**
     * 积分 CSV 导入（B7）。
     *
     * 列格式：`email,delta[,reason]`，首行可选表头（`email` / `邮箱`）。
     * 用邮箱定位用户而不是用户 id —— 运营手里的表格从来只有邮箱。
     *
     * 为什么走 `credit.adjust` 而不是通用数据工具权限：这不是"导入一批数据"，
     * 这是**给钱**。CSV 只是输入格式，权限应当跟着动作走，否则没有
     * `credit.adjust` 的角色就能靠导入绕过积分权限。
     *
     * `delta` 为负即扣减，与人工调整同一套规则（余额不足整条失败，
     * 失败原因原样回传，不写成通用文案）。
     */
    async importCredits(file, dto, actor) {
        if (!file?.buffer?.length) {
            throw new app_exception_1.AppError(40001, "请上传 CSV 文件（字段名 file）", 400);
        }
        return this.commerce.importCreditsCsv(file.buffer.toString("utf8"), {
            validDays: dto.validDays,
            operatorId: actor.id,
            importKey: dto.importKey,
        });
    }
};
exports.AdminCommerceController = AdminCommerceController;
__decorate([
    (0, common_1.Get)("credit-prices"),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.productPrice),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], AdminCommerceController.prototype, "creditPrices", null);
__decorate([
    (0, common_1.Put)("credit-prices"),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.productPrice),
    (0, admin_decorator_1.AuditAction)("credit.price_update"),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [UpdateCreditPricesDto]),
    __metadata("design:returntype", Promise)
], AdminCommerceController.prototype, "updateCreditPrices", null);
__decorate([
    (0, common_1.Post)("credit-prices/:capabilityId/reset"),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.productPrice),
    (0, admin_decorator_1.AuditAction)("credit.price_reset"),
    __param(0, (0, common_1.Param)("capabilityId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], AdminCommerceController.prototype, "resetCreditPrice", null);
__decorate([
    (0, common_1.Get)("products"),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.productRead),
    __param(0, (0, common_1.Query)("status")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], AdminCommerceController.prototype, "products", null);
__decorate([
    (0, common_1.Post)("products"),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.productWrite),
    (0, admin_decorator_1.AuditAction)("product.create"),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [ProductCreateDto]),
    __metadata("design:returntype", void 0)
], AdminCommerceController.prototype, "createProduct", null);
__decorate([
    (0, common_1.Patch)("products/:id"),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.productWrite),
    (0, admin_decorator_1.AuditAction)("product.update"),
    __param(0, (0, common_1.Param)("id")),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, ProductUpdateDto]),
    __metadata("design:returntype", void 0)
], AdminCommerceController.prototype, "updateProduct", null);
__decorate([
    (0, common_1.Patch)("products/:id/status"),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.productWrite),
    (0, admin_decorator_1.AuditAction)("product.status_change"),
    __param(0, (0, common_1.Param)("id")),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, ProductStatusDto]),
    __metadata("design:returntype", Promise)
], AdminCommerceController.prototype, "setProductStatus", null);
__decorate([
    (0, common_1.Get)("orders"),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.orderRead),
    __param(0, (0, common_1.Query)("status")),
    __param(1, (0, common_1.Query)("orderNo")),
    __param(2, (0, common_1.Query)("email")),
    __param(3, (0, common_1.Query)("channel")),
    __param(4, (0, common_1.Query)("refundState")),
    __param(5, (0, common_1.Query)("from")),
    __param(6, (0, common_1.Query)("to")),
    __param(7, (0, common_1.Query)("userId")),
    __param(8, (0, common_1.Query)("page")),
    __param(9, (0, common_1.Query)("pageSize")),
    __param(10, (0, common_1.Query)("sort")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String, String, String, String, String, String, String, String, String]),
    __metadata("design:returntype", void 0)
], AdminCommerceController.prototype, "orderList", null);
__decorate([
    (0, common_1.Get)("orders/export"),
    (0, admin_decorator_1.RequireAllPermissions)(permissions_1.PERMISSIONS.orderRead, permissions_1.PERMISSIONS.dataExport),
    (0, admin_decorator_1.AuditAction)("data.export"),
    __param(0, (0, common_1.Res)()),
    __param(1, (0, common_1.Query)("status")),
    __param(2, (0, common_1.Query)("orderNo")),
    __param(3, (0, common_1.Query)("email")),
    __param(4, (0, common_1.Query)("channel")),
    __param(5, (0, common_1.Query)("refundState")),
    __param(6, (0, common_1.Query)("from")),
    __param(7, (0, common_1.Query)("to")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String, String, String, String, String]),
    __metadata("design:returntype", Promise)
], AdminCommerceController.prototype, "exportOrders", null);
__decorate([
    (0, common_1.Get)("orders/:id"),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.orderRead),
    __param(0, (0, common_1.Param)("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], AdminCommerceController.prototype, "orderDetail", null);
__decorate([
    (0, common_1.Post)("orders/:id/mark-paid"),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.orderMarkPaid),
    (0, admin_decorator_1.AuditAction)("order.mark_paid"),
    __param(0, (0, common_1.Param)("id")),
    __param(1, (0, admin_decorator_1.AdminUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], AdminCommerceController.prototype, "markPaid", null);
__decorate([
    (0, common_1.Post)("orders/batch"),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.orderMarkPaid),
    (0, admin_decorator_1.AuditAction)("order.batch"),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, admin_decorator_1.AdminUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [OrderBatchDto, Object]),
    __metadata("design:returntype", void 0)
], AdminCommerceController.prototype, "batchMarkPaid", null);
__decorate([
    (0, common_1.Post)("orders/:id/refund"),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.orderRefund),
    (0, admin_decorator_1.AuditAction)("order.refund"),
    __param(0, (0, common_1.Param)("id")),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, admin_decorator_1.AdminUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, RefundDto, Object]),
    __metadata("design:returntype", Promise)
], AdminCommerceController.prototype, "refund", null);
__decorate([
    (0, common_1.Get)("payments"),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.paymentRead),
    __param(0, (0, common_1.Query)("status")),
    __param(1, (0, common_1.Query)("pageSize")),
    __param(2, (0, common_1.Query)("from")),
    __param(3, (0, common_1.Query)("to")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String, String]),
    __metadata("design:returntype", void 0)
], AdminCommerceController.prototype, "payments", null);
__decorate([
    (0, common_1.Get)("payments/export"),
    (0, admin_decorator_1.RequireAllPermissions)(permissions_1.PERMISSIONS.paymentRead, permissions_1.PERMISSIONS.dataExport),
    (0, admin_decorator_1.AuditAction)("data.export"),
    __param(0, (0, common_1.Res)()),
    __param(1, (0, common_1.Query)("status")),
    __param(2, (0, common_1.Query)("from")),
    __param(3, (0, common_1.Query)("to")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String]),
    __metadata("design:returntype", Promise)
], AdminCommerceController.prototype, "exportPayments", null);
__decorate([
    (0, common_1.Get)("credits"),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.creditRead),
    __param(0, (0, common_1.Query)("userId")),
    __param(1, (0, common_1.Query)("email")),
    __param(2, (0, common_1.Query)("page")),
    __param(3, (0, common_1.Query)("pageSize")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String, String]),
    __metadata("design:returntype", void 0)
], AdminCommerceController.prototype, "credits", null);
__decorate([
    (0, common_1.Get)("credits/export"),
    (0, admin_decorator_1.RequireAllPermissions)(permissions_1.PERMISSIONS.creditRead, permissions_1.PERMISSIONS.dataExport),
    (0, admin_decorator_1.AuditAction)("data.export"),
    __param(0, (0, common_1.Res)()),
    __param(1, (0, common_1.Query)("userId")),
    __param(2, (0, common_1.Query)("email")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", Promise)
], AdminCommerceController.prototype, "exportCredits", null);
__decorate([
    (0, common_1.Get)("credits/audit"),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.creditRead),
    __param(0, (0, common_1.Query)("limit")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], AdminCommerceController.prototype, "auditCredits", null);
__decorate([
    (0, common_1.Get)("credits/:userId/lots"),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.creditRead),
    __param(0, (0, common_1.Param)("userId")),
    __param(1, (0, common_1.Query)("from")),
    __param(2, (0, common_1.Query)("to")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String]),
    __metadata("design:returntype", void 0)
], AdminCommerceController.prototype, "lots", null);
__decorate([
    (0, common_1.Get)("credits/:userId/ledger"),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.creditRead),
    __param(0, (0, common_1.Param)("userId")),
    __param(1, (0, common_1.Query)("type")),
    __param(2, (0, common_1.Query)("from")),
    __param(3, (0, common_1.Query)("to")),
    __param(4, (0, common_1.Query)("limit")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String, String, String]),
    __metadata("design:returntype", void 0)
], AdminCommerceController.prototype, "ledger", null);
__decorate([
    (0, common_1.Post)("credits/adjust"),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.creditAdjust),
    (0, admin_decorator_1.AuditAction)("credit.adjust"),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, admin_decorator_1.AdminUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [AdjustCreditDto, Object]),
    __metadata("design:returntype", void 0)
], AdminCommerceController.prototype, "adjust", null);
__decorate([
    (0, common_1.Post)("credits/batch-adjust"),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.creditAdjust),
    (0, admin_decorator_1.AuditAction)("credit.batch_adjust"),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, admin_decorator_1.AdminUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [BatchAdjustDto, Object]),
    __metadata("design:returntype", void 0)
], AdminCommerceController.prototype, "batchAdjust", null);
__decorate([
    (0, common_1.Post)("credits/import"),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.creditAdjust),
    (0, admin_decorator_1.AuditAction)("credit.import"),
    (0, common_1.UseInterceptors)((0, platform_express_1.FileInterceptor)("file", {
        storage: (0, multer_1.memoryStorage)(),
        // 2MB ≈ 数万行，足够运营的一次活动补发；再大应拆批
        limits: { fileSize: 2 * 1024 * 1024 },
    })),
    __param(0, (0, common_1.UploadedFile)()),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, admin_decorator_1.AdminUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, CreditImportDto, Object]),
    __metadata("design:returntype", Promise)
], AdminCommerceController.prototype, "importCredits", null);
exports.AdminCommerceController = AdminCommerceController = __decorate([
    (0, common_1.Controller)("admin"),
    __metadata("design:paramtypes", [order_service_1.OrderService,
        commerce_admin_service_1.AdminCommerceService,
        credit_service_1.CreditService,
        credit_price_service_1.CreditPriceService,
        settings_service_1.AdminSettingsService])
], AdminCommerceController);
//# sourceMappingURL=commerce.controller.js.map