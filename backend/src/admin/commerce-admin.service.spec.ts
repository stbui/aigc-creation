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
        refunds: [],
        membershipPlan: null,
      },
    ]);
    prisma.order.count.mockResolvedValue(1);

    const page = await service.listOrders({ productId: 'p-1' });
    expect(page.items[0].items).toEqual([{ name: '体验包', sku: 'PACK_TRIAL' }]);
  });

  it('退款状态列与筛选同源: 命中任意一笔退款单就显示该状态', async () => {
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
        items: [],
        payments: [{ id: 'pay-1' }],
        // 部分退款：先成功退一笔，再有一笔失败。列上必须显示「失败」——
        // 筛选 `?refundState=failed` 用的也是 some 命中任意一笔
        refunds: [{ status: 'failed' }, { status: 'succeeded' }],
        membershipPlan: null,
      },
    ]);
    prisma.order.count.mockResolvedValue(1);

    const page = await service.listOrders({ refundState: 'failed' });
    expect(page.items[0].refundState).toBe('failed');
  });

  it('无退款单时退款状态为 null', async () => {
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
        items: [],
        payments: [{ id: 'pay-1' }],
        refunds: [],
        membershipPlan: null,
      },
    ]);
    prisma.order.count.mockResolvedValue(1);

    const page = await service.listOrders({});
    expect(page.items[0].refundState).toBeNull();
  });
});

type DeleteOrderMockPrisma = {
  order: { findUnique: ReturnType<typeof vi.fn> };
  product: { updateMany: ReturnType<typeof vi.fn> };
  orderItem: { deleteMany: ReturnType<typeof vi.fn> };
  creditLot: { count: ReturnType<typeof vi.fn> };
  creditLedger: { count: ReturnType<typeof vi.fn> };
  creditLedgerEntry: { count: ReturnType<typeof vi.fn> };
  paymentNotification: { count: ReturnType<typeof vi.fn> };
  paymentExceptionCase: { count: ReturnType<typeof vi.fn> };
  paymentReconciliationItem: { count: ReturnType<typeof vi.fn> };
  reconciliationItem: { count: ReturnType<typeof vi.fn> };
  ticket: { count: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
};

describe('AdminCommerceService 删除订单', () => {
  let prisma: DeleteOrderMockPrisma;
  let service: AdminCommerceService;
  let tx: {
    product: { updateMany: ReturnType<typeof vi.fn> };
    orderItem: { deleteMany: ReturnType<typeof vi.fn> };
    order: { deleteMany: ReturnType<typeof vi.fn> };
  };

  const counted = () => vi.fn().mockResolvedValue(0);
  const pendingOrder = (overrides: Record<string, unknown> = {}) => ({
    id: 'o-1',
    orderNo: 'HJ001',
    status: 'pending',
    totalCents: 990,
    // paidCents 是应付金额；未支付订单也可能大于 0，不能据此判断已有支付。
    paidCents: 990,
    refundedCents: 0,
    grantedCredits: 0,
    paidAt: null,
    providerPaidAt: null,
    providerTradeNo: null,
    membershipAppliedAt: null,
    stockReserved: false,
    membership: null,
    items: [
      { productId: 'p-1', quantity: 1, stockReservedSnapshot: 0 },
    ],
    payments: [],
    refunds: [],
    invoices: [],
    membershipUsage: [],
    ...overrides,
  });

  beforeEach(() => {
    tx = {
      product: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      orderItem: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
      order: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
    };
    prisma = {
      order: { findUnique: vi.fn() },
      product: { updateMany: vi.fn() },
      orderItem: { deleteMany: vi.fn() },
      creditLot: { count: counted() },
      creditLedger: { count: counted() },
      creditLedgerEntry: { count: counted() },
      paymentNotification: { count: counted() },
      paymentExceptionCase: { count: counted() },
      paymentReconciliationItem: { count: counted() },
      reconciliationItem: { count: counted() },
      ticket: { count: counted() },
      $transaction: vi.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)),
    };
    service = new AdminCommerceService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
    );
  });

  it('订单不存在返回 404', async () => {
    prisma.order.findUnique.mockResolvedValue(null);

    const error = await service.deleteOrder('o-missing').catch((e) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe(40400);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('已支付订单拒绝删除并引导走退款流程', async () => {
    prisma.order.findUnique.mockResolvedValue(pendingOrder({ status: 'paid', paidCents: 990 }));

    const error = await service.deleteOrder('o-1').catch((e) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe(40901);
    expect((error as AppError).getResponse()).toMatchObject({
      message: expect.stringContaining('已支付订单请通过退款流程处理'),
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('已有支付尝试的待支付订单也拒绝删除', async () => {
    prisma.order.findUnique.mockResolvedValue(
      pendingOrder({ payments: [{ id: 'pay-1' }] }),
    );

    const error = await service.deleteOrder('o-1').catch((e) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe(40901);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('无业务关联的待支付订单删除成功', async () => {
    prisma.order.findUnique.mockResolvedValue(pendingOrder());

    await expect(service.deleteOrder('o-1')).resolves.toEqual({
      id: 'o-1',
      orderNo: 'HJ001',
    });
    expect(tx.orderItem.deleteMany).toHaveBeenCalledWith({ where: { orderId: 'o-1' } });
    expect(tx.order.deleteMany).toHaveBeenCalledWith({
      where: { id: 'o-1', status: { in: ['pending', 'cancelled'] } },
    });
    expect(tx.product.updateMany).not.toHaveBeenCalled();
  });

  it('删除已取消订单时按商品聚合释放预占库存', async () => {
    prisma.order.findUnique.mockResolvedValue(
      pendingOrder({
        status: 'cancelled',
        stockReserved: true,
        items: [
          { productId: 'p-1', quantity: 1, stockReservedSnapshot: 2 },
          { productId: 'p-1', quantity: 1, stockReservedSnapshot: 1 },
          { productId: 'p-2', quantity: 1, stockReservedSnapshot: 1 },
        ],
      }),
    );

    await expect(service.deleteOrder('o-1')).resolves.toMatchObject({ id: 'o-1' });
    expect(tx.product.updateMany).toHaveBeenCalledWith({
      where: { id: 'p-1', stockReserved: { gte: 3 } },
      data: { stockReserved: { decrement: 3 } },
    });
    expect(tx.product.updateMany).toHaveBeenCalledWith({
      where: { id: 'p-2', stockReserved: { gte: 1 } },
      data: { stockReserved: { decrement: 1 } },
    });
  });

  it('只有工单等字符串引用时也拒绝删除', async () => {
    prisma.order.findUnique.mockResolvedValue(pendingOrder());
    prisma.ticket.count.mockResolvedValue(1);

    const error = await service.deleteOrder('o-1').catch((e) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe(40901);
    expect((error as AppError).getResponse()).toMatchObject({
      message: expect.stringContaining('工单关联'),
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('预检后并发产生关联, 外键拒绝转成友好 409', async () => {
    prisma.order.findUnique.mockResolvedValue(pendingOrder());
    tx.order.deleteMany.mockRejectedValue(
      Object.assign(new Error('fk'), { code: 'P2003' }),
    );

    const error = await service.deleteOrder('o-1').catch((e) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe(40901);
    expect((error as AppError).getResponse()).toMatchObject({
      message: expect.stringContaining('刚刚产生了关联记录'),
    });
  });
});
