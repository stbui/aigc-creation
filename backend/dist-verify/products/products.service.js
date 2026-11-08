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
exports.ProductsService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
const app_exception_1 = require("../common/app.exception");
/**
 * C 端商品 (SKU) 查询 (commerce-design.md §8.1 / C2)。
 *
 * **只读** —— 商品的增删改只在后台 (`admin/products`)。
 * 前端落地页与积分商城的价目一律从这里读, 不再各自硬编码。
 *
 * 为什么要单独建模块而不是复用 OrderService:
 * 商品浏览是**免登录的高频读**, 而 OrderService 挂着会员/营销/订单状态机。
 * 把「列商品」塞进去会让每次渲染商城页都拖上一整套下单依赖。
 */
let ProductsService = class ProductsService {
    constructor(prisma) {
        this.prisma = prisma;
    }
    /**
     * 在售商品列表 (公开免登录)。
     *
     * 只返回 `active`: 下架商品对 C 端不可见, 但历史订单快照仍能正常展示 ——
     * 快照存在 OrderItem 上, 不依赖 Product 当前状态。
     */
    async listActive() {
        const rows = await this.prisma.product.findMany({
            where: { status: 'active' },
            orderBy: { sortOrder: 'asc' },
        });
        return rows.map(toProductView);
    }
    /** 按 sku 查单个在售商品 */
    async detailBySku(sku) {
        const row = await this.prisma.product.findUnique({ where: { sku } });
        if (!row || row.status !== 'active') {
            throw new app_exception_1.AppError(40400, '商品不存在或已下架', 404);
        }
        return toProductView(row);
    }
};
exports.ProductsService = ProductsService;
exports.ProductsService = ProductsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], ProductsService);
/**
 * 对外的商品视图。
 *
 * ⚠ **只暴露 C 端渲染必需字段**: 不下发 grantType / sortOrder 等内部字段 ——
 * grantType 泄漏会让用户看到"manual 发放"这类运营口径, 徒增困惑。
 *
 * 金额一律整数分, 前端自行除 100 格式化。**服务端不做元/分的转换** ——
 * 边界转换只在一处发生 (前端展示层), 避免各处四舍五入不一致。
 */
function toProductView(p) {
    return {
        id: p.id,
        sku: p.sku,
        name: p.name,
        description: p.description,
        priceCents: p.priceCents,
        originalPriceCents: p.originalPriceCents,
        credits: p.credits,
        /** 0 = 永久有效, 前端据此显示「永久有效」而非「0 天」 */
        creditsValidDays: p.creditsValidDays,
        type: p.type,
        /** 免费商品 (priceCents=0) 前端显示「免费领取」而非 ¥0.00 */
        isFree: p.priceCents === 0,
    };
}
//# sourceMappingURL=products.service.js.map