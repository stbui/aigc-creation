import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AppError } from '../common/app.exception';

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
@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

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
  async detailBySku(sku: string) {
    const row = await this.prisma.product.findUnique({ where: { sku } });
    if (!row || row.status !== 'active') {
      throw new AppError(40400, '商品不存在或已下架', 404);
    }
    return toProductView(row);
  }
}

/**
 * 对外的商品视图。
 *
 * ⚠ **只暴露 C 端渲染必需字段**: 不下发 grantType / sortOrder 等内部字段 ——
 * grantType 泄漏会让用户看到"manual 发放"这类运营口径, 徒增困惑。
 *
 * 金额一律整数分, 前端自行除 100 格式化。**服务端不做元/分的转换** ——
 * 边界转换只在一处发生 (前端展示层), 避免各处四舍五入不一致。
 */
function toProductView(p: {
  id: string;
  sku: string;
  name: string;
  description: string;
  priceCents: number;
  originalPriceCents: number | null;
  credits: number;
  creditsValidDays: number;
  type: string;
  status: string;
}) {
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