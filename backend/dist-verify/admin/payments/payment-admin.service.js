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
Object.defineProperty(exports, "__esModule", { value: true });
exports.AdminPaymentsService = exports.PAYMENT_EXPORT_LIMIT = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../prisma/prisma.service");
const app_exception_1 = require("../../common/app.exception");
const settings_service_1 = require("../../common/settings.service");
const payment_config_service_1 = require("../../payments/payment-config.service");
const payment_query_1 = require("../../payments/payment-query");
const types_1 = require("../../payments/adapters/types");
/**
 * 支付域导出上限。
 *
 * 财务导出是对账的正式交付物，超过上限必须报错而不是静默截断 ——
 * 少几行的账单比直接失败更危险。
 */
exports.PAYMENT_EXPORT_LIMIT = 10_000;
/** 列表投影：只取页面用到的字段，禁止 include 全量关联造成 N+1 */
const ORDER_LIST_SELECT = {
    id: true,
    orderNo: true,
    userId: true,
    channel: true,
    status: true,
    paidCents: true,
    refundedCents: true,
    currency: true,
    providerConfigId: true,
    providerConfigVersion: true,
    providerTradeNo: true,
    providerStatus: true,
    checkoutMode: true,
    checkoutValue: true,
    checkoutExpiresAt: true,
    providerPaidAt: true,
    paidAt: true,
    closedAt: true,
    createdAt: true,
    updatedAt: true,
    expiresAt: true,
    lastError: true,
    closeStartedAt: true,
    items: { select: { nameSnapshot: true, creditsSnapshot: true, quantity: true } },
    user: { select: { id: true, name: true, email: true } },
};
let AdminPaymentsService = class AdminPaymentsService {
    constructor(prisma, settings, configs) {
        this.prisma = prisma;
        this.settings = settings;
        this.configs = configs;
    }
    // ── 渠道与设置 ──────────────────────────────────────────────────
    providers() {
        return this.configs.listAdmin();
    }
    async settingsView() {
        const currency = await this.settings.get('payment.defaultCurrency');
        return { defaultCurrency: currency };
    }
    // ── 商品 ────────────────────────────────────────────────────────
    async products() {
        const rows = await this.prisma.product.findMany({
            orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
            take: 500,
        });
        const items = rows.map((p) => this.toProductView(p));
        return { items, total: items.length, page: 1, pageSize: items.length };
    }
    async saveProduct(id, input) {
        const data = this.normalizeProductInput(input);
        if (data.currency === 'USD' && data.status === 'active') {
            const available = await this.configs.available('USD');
            if (available.length === 0) {
                throw new app_exception_1.AppError(40001, '当前没有支持 USD 的可用支付渠道，不能上架美元商品', 400);
            }
        }
        if (data.saleStrategy === 'inventory') {
            if (id) {
                const current = await this.prisma.product.findUnique({ where: { id } });
                const stockTotal = Number(data.stockTotal ?? 0);
                if (current && stockTotal < current.stockSold + current.stockReserved) {
                    throw new app_exception_1.AppError(40001, '库存总量不能小于已售 + 已占用', 400);
                }
            }
        }
        if (data.saleStrategy === 'timed' && data.saleStartAt && data.saleEndAt) {
            if (data.saleStartAt >= data.saleEndAt) {
                throw new app_exception_1.AppError(40001, '开售时间必须早于结束时间', 400);
            }
        }
        if (id) {
            const current = await this.prisma.product.findUnique({ where: { id } });
            if (!current)
                throw new app_exception_1.AppError(40400, '商品不存在', 404);
            const updated = await this.prisma.product.update({ where: { id }, data: data });
            return { product: this.toProductView(updated) };
        }
        const sku = `PAY-${stamp()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
        const created = await this.prisma.product.create({
            data: { sku, ...data },
        });
        return { product: this.toProductView(created) };
    }
    // ── 订单 ────────────────────────────────────────────────────────
    async orders(query) {
        const now = new Date();
        const where = (0, payment_query_1.buildAdminPaymentOrderWhere)(query, now);
        const orderBy = (0, payment_query_1.orderByOf)(query.sort);
        const page = query.page ?? 1;
        const pageSize = query.pageSize ?? 30;
        const [rows, total] = await Promise.all([
            this.prisma.order.findMany({
                where,
                orderBy,
                skip: (page - 1) * pageSize,
                take: pageSize,
                select: ORDER_LIST_SELECT,
            }),
            this.prisma.order.count({ where }),
        ]);
        return {
            items: rows.map((row) => this.toOrderRow(row, now)),
            total,
            page,
            pageSize,
        };
    }
    async orderDetail(id) {
        const order = await this.prisma.order.findUnique({
            where: { id },
            include: {
                items: true,
                user: { select: { id: true, name: true, email: true } },
                payments: { orderBy: { createdAt: 'desc' } },
            },
        });
        if (!order)
            throw new app_exception_1.AppError(40400, '订单不存在', 404);
        const now = new Date();
        const row = this.toOrderRow({
            ...order,
            items: order.items.map((i) => ({
                nameSnapshot: i.nameSnapshot,
                creditsSnapshot: i.creditsSnapshot,
                quantity: i.quantity,
            })),
        }, now);
        const actionable = row.status === 'created' || row.status === 'pending' || row.status === 'create_failed' || row.status === 'closing';
        const providerRef = order.payments.find((p) => p.status === 'succeeded')?.providerRef ?? null;
        return {
            order: {
                ...row,
                providerRef,
                rawOrderStatus: order.status,
                items: order.items.map((i) => ({
                    id: i.id,
                    name: i.nameSnapshot,
                    sku: i.skuSnapshot,
                    priceCents: i.priceCentsSnapshot,
                    credits: i.creditsSnapshot,
                    quantity: i.quantity,
                })),
                payments: order.payments.map((p) => ({
                    id: p.id,
                    status: p.status,
                    providerId: p.channel,
                    providerConfigVersion: p.providerConfigVersion,
                    providerRef: p.providerRef,
                    payTransactionId: p.payTransactionId,
                    amountCents: p.amountCents,
                    createdAt: p.createdAt.toISOString(),
                    paidAt: p.paidAt ? p.paidAt.toISOString() : null,
                })),
                actions: {
                    canQuery: actionable && order.channel !== 'free',
                    canClose: actionable,
                },
            },
        };
    }
    async ordersForExport(query) {
        const where = (0, payment_query_1.buildAdminPaymentOrderWhere)(query, new Date());
        /*
         * 导出是财务的正式交付物，超过上限**必须报错**，不能静默截断。
         * 静默截断会让人拿着一份缺行的账单去对账，比直接失败危险得多。
         */
        const total = await this.prisma.order.count({ where });
        if (total > exports.PAYMENT_EXPORT_LIMIT) {
            throw new app_exception_1.AppError(40001, `筛选结果共 ${total} 笔，超过单次导出上限 ${exports.PAYMENT_EXPORT_LIMIT} 笔，请缩小时间范围或分批导出`, 400);
        }
        const rows = await this.prisma.order.findMany({
            where,
            orderBy: (0, payment_query_1.orderByOf)(query.sort),
            take: exports.PAYMENT_EXPORT_LIMIT,
            select: ORDER_LIST_SELECT,
        });
        const now = new Date();
        return rows.map((row) => this.toOrderRow(row, now));
    }
    // ── 内部 ────────────────────────────────────────────────────────
    toProductView(p) {
        const now = Date.now();
        const remaining = p.stockTotal - p.stockSold - p.stockReserved;
        let saleStatus = 'on_sale';
        if (p.status !== 'active')
            saleStatus = 'disabled';
        else if (p.saleStrategy === 'timed' && p.saleStartAt && now < p.saleStartAt.getTime())
            saleStatus = 'upcoming';
        else if (p.saleStrategy === 'timed' && p.saleEndAt && now > p.saleEndAt.getTime())
            saleStatus = 'ended';
        else if (p.saleStrategy === 'inventory' && remaining <= 0)
            saleStatus = 'sold_out';
        return {
            id: p.id,
            sku: p.sku,
            name: p.name,
            description: p.description,
            kind: 'credits',
            currency: p.currency,
            priceCents: p.priceCents,
            originalPriceCents: p.originalPriceCents,
            credits: p.credits,
            creditsValidDays: p.creditsValidDays,
            grantType: p.grantType,
            status: p.status,
            enabled: p.status === 'active',
            sortOrder: p.sortOrder,
            saleStrategy: p.saleStrategy,
            periodDays: p.periodDays,
            periodPurchaseLimit: p.periodPurchaseLimit,
            stockTotal: p.stockTotal,
            stockReserved: p.stockReserved,
            stockSold: p.stockSold,
            stockRemaining: remaining,
            saleStartAt: p.saleStartAt ? p.saleStartAt.toISOString() : null,
            saleEndAt: p.saleEndAt ? p.saleEndAt.toISOString() : null,
            saleStatus,
            canPurchase: saleStatus === 'on_sale',
            createdAt: p.createdAt.toISOString(),
            updatedAt: p.updatedAt.toISOString(),
        };
    }
    toOrderRow(row, now) {
        const status = (0, payment_query_1.paymentStatusOf)({
            status: row.status,
            closeStartedAt: row.closeStartedAt,
            lastError: row.lastError,
            providerConfigId: row.providerConfigId,
            checkoutMode: row.checkoutMode,
        }, now);
        const terminal = status === 'credited' || status === 'closed' || status === 'refunded' || status === 'partial_refunded';
        return {
            id: row.id,
            orderNo: row.orderNo,
            productName: row.items.map((i) => i.nameSnapshot).join(' / ') || '—',
            productKind: 'credits',
            userId: row.userId,
            user: row.user ? { id: row.user.id, name: row.user.name ?? '', email: row.user.email } : null,
            providerId: row.channel,
            providerConfigVersion: row.providerConfigVersion,
            amountCents: row.paidCents,
            currency: row.currency || 'CNY',
            credits: row.items.reduce((sum, i) => sum + i.creditsSnapshot * i.quantity, 0),
            status,
            rawOrderStatus: row.status,
            providerStatus: row.providerStatus,
            providerTradeNo: row.providerTradeNo,
            checkout: {
                mode: row.checkoutMode,
                value: terminal ? '' : row.checkoutValue,
                expiresAt: row.checkoutExpiresAt ? row.checkoutExpiresAt.toISOString() : null,
            },
            expiresAt: row.expiresAt.toISOString(),
            providerPaidAt: row.providerPaidAt ? row.providerPaidAt.toISOString() : null,
            creditedAt: row.paidAt ? row.paidAt.toISOString() : null,
            closedAt: row.closedAt ? row.closedAt.toISOString() : null,
            lastError: row.lastError,
            createdAt: row.createdAt.toISOString(),
            updatedAt: row.updatedAt.toISOString(),
        };
    }
    normalizeProductInput(input) {
        const strategy = String(input.saleStrategy ?? 'unlimited');
        const data = {
            name: String(input.name ?? '').trim(),
            description: String(input.description ?? ''),
            kind: 'credits',
            currency: String(input.currency ?? 'CNY'),
            priceCents: Number(input.priceCents ?? 0),
            originalPriceCents: input.originalPriceCents === undefined || input.originalPriceCents === null
                ? null
                : Number(input.originalPriceCents),
            credits: Number(input.credits ?? 0),
            creditsValidDays: Number(input.creditsValidDays ?? 0),
            grantType: String(input.grantType ?? 'immediate'),
            status: String(input.status ?? 'active'),
            sortOrder: Number(input.sortOrder ?? 0),
            saleStrategy: strategy,
            periodDays: strategy === 'periodic' ? Number(input.periodDays ?? 0) : 0,
            periodPurchaseLimit: strategy === 'periodic' ? Number(input.periodPurchaseLimit ?? 0) : 0,
            stockTotal: strategy === 'inventory' ? Number(input.stockTotal ?? 0) : 0,
            saleStartAt: strategy === 'timed' ? parseShanghai(input.saleStartAt) : null,
            saleEndAt: strategy === 'timed' ? parseShanghai(input.saleEndAt) : null,
        };
        if (strategy === 'periodic') {
            if (Number(data.periodDays) <= 0 || Number(data.periodPurchaseLimit) <= 0) {
                throw new app_exception_1.AppError(40001, '周期购买需要同时填写周期天数与限购次数', 400);
            }
            if (Number(data.periodDays) > 365)
                throw new app_exception_1.AppError(40001, '周期天数不能超过 365 天', 400);
            if (Number(data.periodPurchaseLimit) > 999) {
                throw new app_exception_1.AppError(40001, '周期限购次数不能超过 999', 400);
            }
        }
        if (strategy === 'timed') {
            if (!data.saleStartAt || !data.saleEndAt) {
                throw new app_exception_1.AppError(40001, '限时商品必须填写开始与结束时间', 400);
            }
        }
        if (strategy === 'inventory') {
            /*
             * 0 不是「不限量」：下单校验按 `stockTotal - stockSold - stockReserved`
             * 计算，0 会让任何购买都报库存不足。库存商品必须显式填写正数。
             */
            if (Number(data.stockTotal) < 1) {
                throw new app_exception_1.AppError(40001, '库存商品必须填写大于 0 的库存总量', 400);
            }
            if (Number(data.stockTotal) > 1_000_000) {
                throw new app_exception_1.AppError(40001, '库存总量不能超过 1,000,000', 400);
            }
        }
        if (!types_1.PAYMENT_CURRENCIES.includes(data.currency)) {
            throw new app_exception_1.AppError(40001, '币种只支持 CNY / USD', 400);
        }
        if (Number(data.priceCents) < 1)
            throw new app_exception_1.AppError(40001, '售价最低 1 分', 400);
        if (Number(data.priceCents) > 10_000_000) {
            throw new app_exception_1.AppError(40001, '售价不能超过 100,000 元', 400);
        }
        if (data.originalPriceCents !== null &&
            Number(data.originalPriceCents) < Number(data.priceCents)) {
            throw new app_exception_1.AppError(40001, '划线价不能低于售价', 400);
        }
        if (Number(data.credits) < 1)
            throw new app_exception_1.AppError(40001, '积分最低 1', 400);
        if (Number(data.credits) > 10_000_000) {
            throw new app_exception_1.AppError(40001, '单商品积分不能超过 10,000,000', 400);
        }
        if (Number(data.creditsValidDays) < 0 || Number(data.creditsValidDays) > 3650) {
            throw new app_exception_1.AppError(40001, '积分有效期必须在 0–3650 天之间', 400);
        }
        if (Number(data.sortOrder) < 0 || Number(data.sortOrder) > 9999) {
            throw new app_exception_1.AppError(40001, '排序值必须在 0–9999 之间', 400);
        }
        if (!['unlimited', 'periodic', 'inventory', 'timed'].includes(strategy)) {
            throw new app_exception_1.AppError(40001, '上架策略非法', 400);
        }
        return data;
    }
};
exports.AdminPaymentsService = AdminPaymentsService;
exports.AdminPaymentsService = AdminPaymentsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        settings_service_1.SettingsService,
        payment_config_service_1.PaymentConfigService])
], AdminPaymentsService);
function stamp() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}
/** 后台输入的时间按 Asia/Shanghai 解释，数据库存 UTC */
function parseShanghai(value) {
    if (!value)
        return null;
    const text = String(value).trim();
    if (!text)
        return null;
    const normalized = /^\d{4}-\d{2}-\d{2}$/.test(text)
        ? `${text}T00:00:00+08:00`
        : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(text)
            ? `${text}:00+08:00`
            : /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(text)
                ? `${text.replace(' ', 'T')}:00+08:00`
                : text;
    const date = new Date(normalized);
    if (Number.isNaN(date.getTime()))
        throw new app_exception_1.AppError(40001, `时间格式非法: ${text}`, 400);
    return date;
}
//# sourceMappingURL=payment-admin.service.js.map