import { Injectable } from "@nestjs/common";
import { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { AppError } from "../../common/app.exception";
import { centsToYuan, toCsv, type CsvColumn } from "../../common/csv";
import { EXPORT_LIMIT, type PaymentListQuery } from "./commerce-admin.types";
import { dateRange } from "./commerce-admin.util";

const PAYMENT_INCLUDE = {
  order: { select: { orderNo: true } },
  user: { select: { email: true } },
} satisfies Prisma.PaymentInclude;

type PaymentRow = Prisma.PaymentGetPayload<{ include: typeof PAYMENT_INCLUDE }>;

/**
 * 后台支付流水查询与导出。
 *
 * 导出是财务对账的交付物：超过上限必须失败，不能静默截断 ——
 * 少几行的账单看起来和正常文件一模一样，差额永远查不出来。
 */
@Injectable()
export class AdminCommercePaymentService {
  constructor(private readonly prisma: PrismaService) {}

  private paymentWhere(q: PaymentListQuery): Prisma.PaymentWhereInput {
    const where: Prisma.PaymentWhereInput = {};
    if (q.status) where.status = q.status;
    const range = dateRange(q.from, q.to);
    if (range) where.createdAt = range;
    return where;
  }

  async listPayments(q: PaymentListQuery) {
    const take = Math.min(q.pageSize ?? 50, 200);
    const list = await this.prisma.payment.findMany({
      where: this.paymentWhere(q),
      orderBy: { createdAt: "desc" },
      take,
      include: PAYMENT_INCLUDE,
    });
    return list.map((payment: PaymentRow) => ({
      id: payment.id,
      orderNo: payment.order?.orderNo ?? "",
      orderId: payment.orderId,
      userEmail: payment.user?.email ?? "",
      channel: payment.channel,
      payTransactionId: payment.payTransactionId,
      amountCents: payment.amountCents,
      status: payment.status,
      message: payment.message,
      sandboxScenario: payment.sandboxScenario,
      paidAt: payment.paidAt,
      createdAt: payment.createdAt,
    }));
  }

  async exportPayments(q: PaymentListQuery): Promise<string> {
    const where = this.paymentWhere(q);
    // 与订单导出同一口径：先数总数，超限直接失败而不是 take 静默截断
    const total = await this.prisma.payment.count({ where });
    if (total > EXPORT_LIMIT) {
      throw new AppError(
        40001,
        `筛选结果共 ${total} 笔，超过单次导出上限 ${EXPORT_LIMIT} 笔，请缩小时间范围后分批导出`,
        400,
      );
    }

    const rows = await this.prisma.payment.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: EXPORT_LIMIT,
      include: PAYMENT_INCLUDE,
    });
    const columns: CsvColumn<(typeof rows)[number]>[] = [
      { label: "订单号", value: (payment) => payment.order?.orderNo ?? "" },
      { label: "用户邮箱", value: (payment) => payment.user?.email ?? "" },
      { label: "渠道", value: (payment) => payment.channel },
      { label: "渠道流水号", value: (payment) => payment.payTransactionId },
      { label: "金额(分)", value: (payment) => payment.amountCents },
      { label: "金额(元)", value: (payment) => centsToYuan(payment.amountCents) },
      { label: "状态", value: (payment) => payment.status },
      { label: "说明", value: (payment) => payment.message ?? "" },
      { label: "沙箱场景", value: (payment) => payment.sandboxScenario ?? "" },
      { label: "支付时间", value: (payment) => payment.paidAt ?? "" },
      { label: "创建时间", value: (payment) => payment.createdAt },
    ];
    return toCsv(columns, rows);
  }
}
