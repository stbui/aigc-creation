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
exports.AdminPaymentReconciliationController = exports.AdminPaymentOrdersController = exports.AdminPaymentConfigController = void 0;
const common_1 = require("@nestjs/common");
const platform_express_1 = require("@nestjs/platform-express");
const multer_1 = require("multer");
const admin_decorator_1 = require("../admin.decorator");
const permissions_1 = require("../permissions");
const payment_admin_service_1 = require("./payment-admin.service");
const payment_order_service_1 = require("../../payments/payment-order.service");
const payment_reconciliation_service_1 = require("../../payments/payment-reconciliation.service");
const payment_config_service_1 = require("../../payments/payment-config.service");
const settings_service_1 = require("../settings.service");
const payment_admin_dto_1 = require("../dto/payment-admin.dto");
const app_exception_1 = require("../../common/app.exception");
const csv_response_1 = require("../../common/csv-response");
const csv_1 = require("../../common/csv");
const payment_query_1 = require("../../payments/payment-query");
/**
 * 后台「支付充值」—— 渠道配置、站点币种、充值商品。
 *
 * 权限口径：
 *   · 读取  `payment.read`
 *   · 保存渠道配置 `payment.write`（高危，写审计）
 *   · 商品编辑 `product.write`
 */
let AdminPaymentConfigController = class AdminPaymentConfigController {
    constructor(admin, configs, settings) {
        this.admin = admin;
        this.configs = configs;
        this.settings = settings;
    }
    async providers() {
        const items = await this.configs.listAdmin();
        return { items, total: items.length, page: 1, pageSize: items.length };
    }
    saveProvider(providerId, dto, admin) {
        return this.configs.saveVersion(providerId, {
            enabled: dto.enabled,
            closeAfterMinutes: dto.closeAfterMinutes,
            values: dto.values,
        }, admin.id);
    }
    settingsView() {
        return this.admin.settingsView();
    }
    async saveSettings(dto, admin) {
        await this.settings.updateAll({ "payment.defaultCurrency": dto.defaultCurrency }, [], admin.id);
        return this.admin.settingsView();
    }
    products() {
        return this.admin.products();
    }
    createProduct(dto) {
        return this.admin.saveProduct(null, dto);
    }
    updateProduct(id, dto) {
        return this.admin.saveProduct(id, dto);
    }
};
exports.AdminPaymentConfigController = AdminPaymentConfigController;
__decorate([
    (0, common_1.Get)("providers"),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.paymentRead),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], AdminPaymentConfigController.prototype, "providers", null);
__decorate([
    (0, common_1.Put)("providers/:providerId/config"),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.paymentWrite),
    (0, admin_decorator_1.AuditAction)("payment.provider_config_save"),
    __param(0, (0, common_1.Param)("providerId")),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, admin_decorator_1.AdminUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, payment_admin_dto_1.PaymentProviderConfigUpdateDto, Object]),
    __metadata("design:returntype", void 0)
], AdminPaymentConfigController.prototype, "saveProvider", null);
__decorate([
    (0, common_1.Get)("settings"),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.paymentRead),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], AdminPaymentConfigController.prototype, "settingsView", null);
__decorate([
    (0, common_1.Put)("settings"),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.paymentWrite),
    (0, admin_decorator_1.AuditAction)("payment.settings_save"),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, admin_decorator_1.AdminUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [payment_admin_dto_1.PaymentSettingsUpdateDto, Object]),
    __metadata("design:returntype", Promise)
], AdminPaymentConfigController.prototype, "saveSettings", null);
__decorate([
    (0, common_1.Get)("products"),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.productRead),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], AdminPaymentConfigController.prototype, "products", null);
__decorate([
    (0, common_1.Post)("products"),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.productWrite),
    (0, admin_decorator_1.AuditAction)("payment.product_create"),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [payment_admin_dto_1.PaymentProductSaveDto]),
    __metadata("design:returntype", void 0)
], AdminPaymentConfigController.prototype, "createProduct", null);
__decorate([
    (0, common_1.Put)("products/:id"),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.productWrite),
    (0, admin_decorator_1.AuditAction)("payment.product_update"),
    __param(0, (0, common_1.Param)("id")),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, payment_admin_dto_1.PaymentProductSaveDto]),
    __metadata("design:returntype", void 0)
], AdminPaymentConfigController.prototype, "updateProduct", null);
exports.AdminPaymentConfigController = AdminPaymentConfigController = __decorate([
    (0, common_1.Controller)("admin/payments"),
    __metadata("design:paramtypes", [payment_admin_service_1.AdminPaymentsService,
        payment_config_service_1.PaymentConfigService,
        settings_service_1.AdminSettingsService])
], AdminPaymentConfigController);
/**
 * 后台「支付订单」—— 列表、详情、查单、关单、导出。
 *
 * 查单/关单用 `payment.operate`：它只推进渠道已经发生的事实，不能凭空造钱，
 * 因此不是高危权限；但每次仍写普通审计。
 */
let AdminPaymentOrdersController = class AdminPaymentOrdersController {
    constructor(admin, orders) {
        this.admin = admin;
        this.orders = orders;
    }
    list(query) {
        return this.admin.orders({
            status: query.status,
            keyword: query.keyword,
            providerId: query.providerId,
            timeField: query.timeField,
            from: query.from,
            to: query.to,
            sort: query.sort,
            page: query.page,
            pageSize: query.pageSize,
        });
    }
    async export(query, res) {
        const rows = await this.admin.ordersForExport({
            status: query.status,
            keyword: query.keyword,
            providerId: query.providerId,
            timeField: query.timeField,
            from: query.from,
            to: query.to,
            sort: query.sort,
        });
        const csv = (0, csv_1.toCsv)([
            { label: "订单号", value: (r) => r.orderNo },
            { label: "用户ID", value: (r) => r.userId },
            { label: "用户名", value: (r) => r.user?.name ?? "" },
            { label: "用户邮箱", value: (r) => r.user?.email ?? "" },
            { label: "商品", value: (r) => r.productName },
            { label: "渠道", value: (r) => r.providerId },
            { label: "金额(分)", value: (r) => r.amountCents },
            { label: "币种", value: (r) => r.currency },
            { label: "权益(积分)", value: (r) => r.credits },
            { label: "状态", value: (r) => r.status },
            { label: "配置版本", value: (r) => r.providerConfigVersion ?? "" },
            { label: "渠道交易号", value: (r) => r.providerTradeNo ?? "" },
            {
                label: "创建时间",
                value: (r) => (0, payment_query_1.formatShanghai)(new Date(r.createdAt)),
            },
            {
                label: "支付时间",
                value: (r) => (0, payment_query_1.formatShanghai)(r.providerPaidAt ? new Date(r.providerPaidAt) : null),
            },
            {
                label: "入账时间",
                value: (r) => (0, payment_query_1.formatShanghai)(r.creditedAt ? new Date(r.creditedAt) : null),
            },
            {
                label: "关闭时间",
                value: (r) => (0, payment_query_1.formatShanghai)(r.closedAt ? new Date(r.closedAt) : null),
            },
        ], rows);
        (0, csv_response_1.sendCsv)(res, "支付订单", csv);
    }
    detail(id) {
        return this.admin.orderDetail(id);
    }
    async query(id, admin) {
        const view = await this.orders.query({
            orderId: id,
            actor: { kind: "admin", adminId: admin.id },
        });
        return {
            order: { id: view.orderId, status: view.displayStatus },
            view,
        };
    }
    async close(id, admin) {
        const view = await this.orders.close({
            orderId: id,
            actor: { kind: "admin", adminId: admin.id },
        });
        return { order: { id: view.orderId, status: view.displayStatus }, view };
    }
};
exports.AdminPaymentOrdersController = AdminPaymentOrdersController;
__decorate([
    (0, common_1.Get)(),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.paymentRead),
    __param(0, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [payment_admin_dto_1.PaymentOrderListQueryDto]),
    __metadata("design:returntype", void 0)
], AdminPaymentOrdersController.prototype, "list", null);
__decorate([
    (0, common_1.Get)("export.csv"),
    (0, admin_decorator_1.RequireAllPermissions)(permissions_1.PERMISSIONS.paymentRead, permissions_1.PERMISSIONS.dataExport),
    (0, admin_decorator_1.AuditAction)("data.export"),
    __param(0, (0, common_1.Query)()),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [payment_admin_dto_1.PaymentOrderListQueryDto, Object]),
    __metadata("design:returntype", Promise)
], AdminPaymentOrdersController.prototype, "export", null);
__decorate([
    (0, common_1.Get)(":id"),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.paymentRead),
    __param(0, (0, common_1.Param)("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], AdminPaymentOrdersController.prototype, "detail", null);
__decorate([
    (0, common_1.Post)(":id/query"),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.paymentOperate),
    (0, admin_decorator_1.AuditAction)("payment.order_query"),
    __param(0, (0, common_1.Param)("id")),
    __param(1, (0, admin_decorator_1.AdminUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], AdminPaymentOrdersController.prototype, "query", null);
__decorate([
    (0, common_1.Post)(":id/close"),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.paymentOperate),
    (0, admin_decorator_1.AuditAction)("payment.order_close"),
    __param(0, (0, common_1.Param)("id")),
    __param(1, (0, admin_decorator_1.AdminUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], AdminPaymentOrdersController.prototype, "close", null);
exports.AdminPaymentOrdersController = AdminPaymentOrdersController = __decorate([
    (0, common_1.Controller)("admin/payments/orders"),
    __metadata("design:paramtypes", [payment_admin_service_1.AdminPaymentsService,
        payment_order_service_1.PaymentOrderService])
], AdminPaymentOrdersController);
/**
 * 后台「支付对账」—— 执行、列表、明细、导入、导出。
 */
let AdminPaymentReconciliationController = class AdminPaymentReconciliationController {
    constructor(admin, reconciliation) {
        this.admin = admin;
        this.reconciliation = reconciliation;
    }
    async run(dto, admin) {
        return this.reconciliation.run({
            providerId: dto.providerId,
            billDate: dto.billDate,
            retryFailed: dto.retryFailed,
            actorId: admin.id,
        });
    }
    list(query) {
        return this.reconciliation.list({
            providerId: query.providerId,
            status: query.status,
            from: query.from,
            to: query.to,
            page: query.page,
            pageSize: query.pageSize,
        });
    }
    async exportRuns(query, res) {
        const rows = await this.reconciliation.runsForExport({
            providerId: query.providerId,
            status: query.status,
            from: query.from,
            to: query.to,
        });
        const csv = (0, csv_1.toCsv)([
            { label: "账单日期", value: (r) => r.billDate },
            { label: "渠道", value: (r) => r.providerId },
            { label: "执行次数", value: (r) => r.attempt },
            { label: "状态", value: (r) => r.status },
            { label: "总笔数", value: (r) => r.totalItems },
            { label: "一致", value: (r) => r.matchItems },
            { label: "自动补发", value: (r) => r.recoveredItems },
            { label: "异常", value: (r) => r.errorItems },
            { label: "错误", value: (r) => r.error ?? "" },
            { label: "开始时间", value: (r) => (0, payment_query_1.formatShanghai)(r.startedAt) },
            { label: "完成时间", value: (r) => (0, payment_query_1.formatShanghai)(r.completedAt) },
        ], rows);
        (0, csv_response_1.sendCsv)(res, "支付对账", csv);
    }
    async exportItems(id, result, res) {
        const rows = await this.reconciliation.itemsForExport(id, result);
        const csv = (0, csv_1.toCsv)([
            { label: "结果", value: (r) => r.result },
            { label: "商户订单号", value: (r) => r.merchantOrderNo },
            { label: "渠道交易号", value: (r) => r.providerTradeNo ?? "" },
            { label: "金额(分)", value: (r) => r.amountCents },
            { label: "币种", value: (r) => r.currency },
            { label: "说明", value: (r) => r.detail ?? "" },
        ], rows);
        (0, csv_response_1.sendCsv)(res, "支付对账明细", csv);
    }
    items(id, query) {
        return this.reconciliation.items(id, {
            result: query.result,
            page: query.page,
            pageSize: query.pageSize,
        });
    }
    async import(file, dto, admin) {
        if (!file?.buffer?.length)
            throw new app_exception_1.AppError(40001, "请上传对账单文件 (字段名 file)", 400);
        const name = file.originalname ?? "bill.csv";
        const isCsv = /\.csv$/i.test(name);
        const isAlipayZip = /\.zip$/i.test(name) && dto.providerId === "alipay";
        if (!isCsv && !isAlipayZip) {
            throw new app_exception_1.AppError(40001, "对账单只支持 .csv，或支付宝渠道的 .zip", 400);
        }
        return this.reconciliation.importCsv({
            providerId: dto.providerId,
            billDate: dto.billDate,
            file: file.buffer,
            fileName: name,
            actorId: admin.id,
        });
    }
};
exports.AdminPaymentReconciliationController = AdminPaymentReconciliationController;
__decorate([
    (0, common_1.Post)(),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.financeReconcile),
    (0, admin_decorator_1.AuditAction)("payment.reconciliation_run"),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, admin_decorator_1.AdminUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [payment_admin_dto_1.ReconciliationRunDto, Object]),
    __metadata("design:returntype", Promise)
], AdminPaymentReconciliationController.prototype, "run", null);
__decorate([
    (0, common_1.Get)(),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.paymentRead),
    __param(0, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [payment_admin_dto_1.ReconciliationListQueryDto]),
    __metadata("design:returntype", void 0)
], AdminPaymentReconciliationController.prototype, "list", null);
__decorate([
    (0, common_1.Get)("export.csv"),
    (0, admin_decorator_1.RequireAllPermissions)(permissions_1.PERMISSIONS.paymentRead, permissions_1.PERMISSIONS.dataExport),
    (0, admin_decorator_1.AuditAction)("data.export"),
    __param(0, (0, common_1.Query)()),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [payment_admin_dto_1.ReconciliationListQueryDto, Object]),
    __metadata("design:returntype", Promise)
], AdminPaymentReconciliationController.prototype, "exportRuns", null);
__decorate([
    (0, common_1.Get)(":id/items/export.csv"),
    (0, admin_decorator_1.RequireAllPermissions)(permissions_1.PERMISSIONS.paymentRead, permissions_1.PERMISSIONS.dataExport),
    (0, admin_decorator_1.AuditAction)("data.export"),
    __param(0, (0, common_1.Param)("id")),
    __param(1, (0, common_1.Query)("result")),
    __param(2, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, Object]),
    __metadata("design:returntype", Promise)
], AdminPaymentReconciliationController.prototype, "exportItems", null);
__decorate([
    (0, common_1.Get)(":id/items"),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.paymentRead),
    __param(0, (0, common_1.Param)("id")),
    __param(1, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, payment_admin_dto_1.ReconciliationItemsQueryDto]),
    __metadata("design:returntype", void 0)
], AdminPaymentReconciliationController.prototype, "items", null);
__decorate([
    (0, common_1.Post)("import"),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.financeReconcile),
    (0, admin_decorator_1.AuditAction)("payment.reconciliation_import"),
    (0, common_1.UseInterceptors)((0, platform_express_1.FileInterceptor)("file", {
        storage: (0, multer_1.memoryStorage)(),
        limits: { fileSize: 20 * 1024 * 1024 },
    })),
    __param(0, (0, common_1.UploadedFile)()),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, admin_decorator_1.AdminUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, payment_admin_dto_1.ReconciliationImportDto, Object]),
    __metadata("design:returntype", Promise)
], AdminPaymentReconciliationController.prototype, "import", null);
exports.AdminPaymentReconciliationController = AdminPaymentReconciliationController = __decorate([
    (0, common_1.Controller)("admin/payments/reconciliations"),
    __metadata("design:paramtypes", [payment_admin_service_1.AdminPaymentsService,
        payment_reconciliation_service_1.PaymentReconciliationService])
], AdminPaymentReconciliationController);
//# sourceMappingURL=payment-admin.controller.js.map