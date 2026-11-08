import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppError } from '../common/app.exception';
import { AdminCommerceService } from './commerce-admin.service';

type MockPrisma = {
  product: {
    findUnique: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
  order: {
    findMany: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
  };
};

describe('AdminCommerceService 商品删除', () => {
  let prisma: MockPrisma;
  let service: AdminCommerceService;

  beforeEach(() => {
    prisma = {
      product: {
        findUnique: vi.fn(),
        findMany: vi.fn(),
        delete: vi.fn(),
      },
      order: { findMany: vi.fn(), count: vi.fn() },
    };
    service = new AdminCommerceService(
      prisma as never,
      {} as never,
      {} as never,
    );
  });

  it('商品不存在返回 404', async () => {
    prisma.product.findUnique.mockResolvedValue(null);

    const error = await service.deleteProduct('p-1').catch((e) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe(40400);
    expect(prisma.product.delete).not.toHaveBeenCalled();
  });

  it('有历史订单的商品拒绝删除, 并提示改为下架', async () => {
    prisma.product.findUnique.mockResolvedValue({
      id: 'p-1',
      sku: 'CREDITS_STARTER',
      _count: { orderItems: 3 },
    });

    const error = await service.deleteProduct('p-1').catch((e) => e);
    expect(error).toBeInstanceOf(AppError);
    // 409 而不是外键报错: 运营要拿到能照做的下一步
    expect((error as AppError).code).toBe(40901);
    expect((error as AppError).getResponse()).toMatchObject({
      message: expect.stringContaining('请改为下架'),
    });
    expect(prisma.product.delete).not.toHaveBeenCalled();
  });

  it('没有订单的商品物理删除并回传 SKU', async () => {
    prisma.product.findUnique.mockResolvedValue({
      id: 'p-1',
      sku: 'PACK_TRIAL',
      _count: { orderItems: 0 },
    });
    prisma.product.delete.mockResolvedValue({ id: 'p-1' });

    await expect(service.deleteProduct('p-1')).resolves.toEqual({
      id: 'p-1',
      sku: 'PACK_TRIAL',
    });
    expect(prisma.product.delete).toHaveBeenCalledWith({ where: { id: 'p-1' } });
  });

  it('预检后并发产生订单, 外键拒绝也转成同一条 409', async () => {
    prisma.product.findUnique.mockResolvedValue({
      id: 'p-1',
      sku: 'PACK_TRIAL',
      _count: { orderItems: 0 },
    });
    prisma.product.delete.mockRejectedValue(Object.assign(new Error('fk'), { code: 'P2003' }));

    const error = await service.deleteProduct('p-1').catch((e) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe(40901);
  });

  it('列表带回 orderCount, 供前台在确认前拦截', async () => {
    prisma.product.findMany.mockResolvedValue([
      {
        id: 'p-1',
        sku: 'PACK_TRIAL',
        name: '体验包',
        description: '',
        type: 'credits',
        priceCents: 990,
        originalPriceCents: null,
        credits: 1000,
        creditsValidDays: 0,
        grantType: 'immediate',
        status: 'active',
        sortOrder: 100,
        _count: { orderItems: 2 },
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-02'),
      },
    ]);

    const rows = await service.listProducts();
    expect(rows[0].orderCount).toBe(2);
  });
});

describe('AdminCommerceService 按商品筛订单', () => {
  let prisma: MockPrisma;
  let service: AdminCommerceService;

  beforeEach(() => {
    prisma = {
      product: {
        findUnique: vi.fn(),
        findMany: vi.fn(),
        delete: vi.fn(),
      },
      order: {
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(0),
      },
    };
    service = new AdminCommerceService(
      prisma as never,
      {} as never,
      {} as never,
    );
  });

  it('productId 走明细行 some, 不是 SKU 快照字符串', async () => {
    await service.listOrders({ productId: 'p-1' });

    const where = prisma.order.findMany.mock.calls[0][0].where;
    expect(where.items).toEqual({ some: { productId: 'p-1' } });
  });

  it('未传 productId 时不加商品条件, 列表口径不变', async () => {
    await service.listOrders({});

    const where = prisma.order.findMany.mock.calls[0][0].where;
    expect(where.items).toBeUndefined();
  });

  it('列表项带出明细快照名与 SKU', async () => {
    prisma.order.findMany.mockResolvedValue([
      {
        id: 'o-1',
        orderNo: 'HJ001',
        userId: 'u-1',
        status: 'paid',
        channel: 'sandbox',
        totalCents: 990,
        discountCents: 0,
        paidCents: 990,
        refundedCents: 0,
        grantedCredits: 100,
        createdAt: new Date('2026-01-01'),
        paidAt: new Date('2026-01-01'),
        user: { email: 'a@b.com' },
        items: [{ id: 'i-1', nameSnapshot: '体验包', skuSnapshot: 'PACK_TRIAL' }],
        payments: [{ id: 'pay-1' }],
        membershipPlan: null,
      },
    ]);
    prisma.order.count.mockResolvedValue(1);

    const page = await service.listOrders({ productId: 'p-1' });
    expect(page.items[0].items).toEqual([{ name: '体验包', sku: 'PACK_TRIAL' }]);
  });
});
