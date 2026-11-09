import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AppError } from '../../common/app.exception';
import { SettingsService } from '../../common/settings.service';
import { PaymentConfigService } from '../../payments/payment-config.service';
import {
  buildAdminPaymentOrderWhere,
  orderByOf,
  paymentStatusOf,
  PaymentDisplayStatus,
} from '../../payments/payment-query';

/**
 * 支付域导出上限。
 *
 * 财务导出是对账的正式交付物，超过上限必须报错而不是静默截断 ——
 * 少几行的账单比直接失败更危险。
 */
export const PAYMENT_EXPORT_LIMIT = 10_000;

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
} satisfies Prisma.OrderSelect;

export interface AdminPaymentOrderRow {
  id: string;
  orderNo: string;
  productName: string;
  productKind: 'credits';
  userId: string;
  user: { id: string; name: string; email: string } | null;
  providerId: string;
  providerConfigVersion: number | null;
  amountCents: number;
  currency: string;
  credits: number;
  status: PaymentDisplayStatus;
  rawOrderStatus: string;
  providerStatus: string | null;
  providerTradeNo: string | null;
  checkout: { mode: string | null; value: string | null; expiresAt: string | null };
  expiresAt: string;
  providerPaidAt: string | null;
  creditedAt: string | null;
  closedAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

@Injectable()
export class AdminPaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly configs: PaymentConfigService,
  ) {}

  // ── 渠道与设置 ──────────────────────────────────────────────────

  providers() {
    return this.configs.listAdmin();
  }

  async settingsView() {
    const currency = await this.settings.get<string>('payment.defaultCurrency');
    return { defaultCurrency: currency };
  }

  // ── 订单 ────────────────────────────────────────────────────────

  async orders(query: {
    status?: string;
    keyword?: string;
    providerId?: string;
    timeField?: string;
    from?: string;
    to?: string;
    sort?: string;
    page?: number;
    pageSize?: number;
  }) {
    const now = new Date();
    const where = buildAdminPaymentOrderWhere(query, now);
    const orderBy = orderByOf(query.sort);
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

  async orderDetail(id: string) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: {
        items: true,
        user: { select: { id: true, name: true, email: true } },
        payments: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!order) throw new AppError(40400, '订单不存在', 404);

    const now = new Date();
    const row = this.toOrderRow(
      {
        ...order,
        items: order.items.map((i) => ({
          nameSnapshot: i.nameSnapshot,
          creditsSnapshot: i.creditsSnapshot,
          quantity: i.quantity,
        })),
      },
      now,
    );

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

  async ordersForExport(query: Parameters<AdminPaymentsService['orders']>[0]) {
    const where = buildAdminPaymentOrderWhere(query, new Date());
    /*
     * 导出是财务的正式交付物，超过上限**必须报错**，不能静默截断。
     * 静默截断会让人拿着一份缺行的账单去对账，比直接失败危险得多。
     */
    const total = await this.prisma.order.count({ where });
    if (total > PAYMENT_EXPORT_LIMIT) {
      throw new AppError(
        40001,
        `筛选结果共 ${total} 笔，超过单次导出上限 ${PAYMENT_EXPORT_LIMIT} 笔，请缩小时间范围或分批导出`,
        400,
      );
    }
    const rows = await this.prisma.order.findMany({
      where,
      orderBy: orderByOf(query.sort),
      take: PAYMENT_EXPORT_LIMIT,
      select: ORDER_LIST_SELECT,
    });
    const now = new Date();
    return rows.map((row) => this.toOrderRow(row, now));
  }

  // ── 内部 ────────────────────────────────────────────────────────

  private toOrderRow(
    row: {
      id: string;
      orderNo: string;
      userId: string;
      channel: string;
      status: string;
      paidCents: number;
      currency: string;
      providerConfigVersion: number | null;
      providerTradeNo: string | null;
      providerStatus: string | null;
      checkoutMode: string | null;
      checkoutValue: string | null;
      checkoutExpiresAt: Date | null;
      providerPaidAt: Date | null;
      paidAt: Date | null;
      closedAt: Date | null;
      createdAt: Date;
      updatedAt: Date;
      expiresAt: Date;
      lastError: string | null;
      closeStartedAt: Date | null;
      providerConfigId: string | null;
      items: Array<{ nameSnapshot: string; creditsSnapshot: number; quantity: number }>;
      user: { id: string; name: string | null; email: string } | null;
    },
    now: Date,
  ): AdminPaymentOrderRow {
    const status = paymentStatusOf(
      {
        status: row.status,
        closeStartedAt: row.closeStartedAt,
        lastError: row.lastError,
        providerConfigId: row.providerConfigId,
        checkoutMode: row.checkoutMode,
      },
      now,
    );
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
}
