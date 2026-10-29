import { Injectable, Logger } from '@nestjs/common';
import { AppError } from '../common/app.exception';
import { PrismaService } from '../prisma/prisma.service';
import { parseCsv, toCsv } from '../common/csv';

/**
 * 渠道账单对账 (B3)。
 *
 * 输入是渠道导出的 CSV (或本地回调自动产生的差异), 输出是**差异清单**。
 * 处置只改 `ReconciliationItem.status` —— 不退钱、不补单、不改订单状态:
 * 资金动作必须回订单模块走各自的审计与权限链路, 对账工具只负责把
 * 「哪里对不上」找出来并留痕。
 *
 * 行级差异类型:
 *   matched          本地有这笔支付且金额一致
 *   amount_mismatch  金额不一致 / 本地支付不是成功态
 *   missing_local    渠道有、本地没有 (钱收了但订单没置 paid, 最严重)
 *   missing_channel  本地有、渠道账单没有 (渠道漏单或本地误记)
 *   duplicate        账单里同一交易号出现多次
 */

/** 表头别名 —— 各家渠道导出的列名不同, 兼容常见写法 */
const TRADE_NO_KEYS = ['tradeno', 'trade_no', 'transaction_id', 'transactionid', '交易号', '流水号'];
const AMOUNT_KEYS = ['amountcents', 'amount_cents', 'amount', 'total_amount', '金额', '金额(分)'];
const ORDER_NO_KEYS = ['orderno', 'order_no', 'out_trade_no', '商户订单号', '订单号'];

export interface ImportBatchInput {
  channel: string;
  billDate: string;
  fileName?: string;
  csv: string;
  operatorId: string;
}

@Injectable()
export class AdminReconciliationService {
  private readonly logger = new Logger(AdminReconciliationService.name);

  constructor(private readonly prisma: PrismaService) {}

  async importBatch(input: ImportBatchInput) {
    const channel = (input.channel ?? '').trim().toLowerCase();
    if (!['alipay', 'wechat', 'sandbox'].includes(channel)) {
      throw new AppError(40001, '渠道只支持 alipay / wechat / sandbox', 400);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.billDate ?? '')) {
      throw new AppError(40001, '账单日期格式必须为 YYYY-MM-DD', 400);
    }
    if (!input.csv || !input.csv.trim()) {
      throw new AppError(40001, '对账文件为空', 400);
    }

    const rows = parseCsv(input.csv);
    if (rows.length === 0) throw new AppError(40001, '对账文件为空', 400);

    const header = rows[0].map((h) => h.trim().toLowerCase());
    const hasHeader = TRADE_NO_KEYS.some((k) => header.includes(k.toLowerCase()));
    const dataRows = hasHeader ? rows.slice(1) : rows;

    const idx = {
      tradeNo: hasHeader ? findIndex(header, TRADE_NO_KEYS) : 0,
      amount: hasHeader ? findIndex(header, AMOUNT_KEYS) : 1,
      orderNo: hasHeader ? findIndex(header, ORDER_NO_KEYS) : 2,
    };
    if (idx.tradeNo < 0 || idx.amount < 0) {
      throw new AppError(
        40001,
        '缺少交易号或金额列 (支持表头 tradeNo/amountCents 或交易号/金额)',
        400,
      );
    }
    // 金额列名里带「分」或 cents 时按整数分解析, 否则按元解析 —— 猜错
    // 会让整批差异金额全部放大 100 倍, 且看起来"每一笔都不对"
    const amountIsCents =
      !hasHeader || /cent|分/i.test(rows[0][idx.amount] ?? '') || header[idx.amount]?.includes('cent');

    // 同一交易号可能重复出现: 先按交易号归并
    const grouped = new Map<string, { amounts: number[]; orderNo?: string; occurrences: number }>();
    let channelAmountCents = 0;
    for (const r of dataRows) {
      const tradeNo = (r[idx.tradeNo] ?? '').trim();
      if (!tradeNo) continue;
      const amountCents = parseAmount(r[idx.amount], amountIsCents);
      if (!Number.isInteger(amountCents) || amountCents < 0) {
        throw new AppError(40001, `交易号 ${tradeNo} 的金额无法解析: ${r[idx.amount]}`, 400);
      }
      const orderNo = idx.orderNo >= 0 ? (r[idx.orderNo] ?? '').trim() || undefined : undefined;
      channelAmountCents += amountCents;

      const hit = grouped.get(tradeNo);
      if (hit) {
        hit.occurrences += 1;
        hit.amounts.push(amountCents);
      } else {
        grouped.set(tradeNo, { amounts: [amountCents], orderNo, occurrences: 1 });
      }
    }

    if (grouped.size === 0) throw new AppError(40001, '对账文件没有有效数据行', 400);

    // 本地当日该渠道的成功支付 (用于 matched / amount_mismatch / missing_channel)
    const dayStart = new Date(`${input.billDate}T00:00:00`);
    const dayEnd = new Date(dayStart.getTime() + 24 * 3600 * 1000);
    const localPayments = await this.prisma.payment.findMany({
      where: {
        channel,
        status: 'succeeded',
        paidAt: { gte: dayStart, lt: dayEnd },
      },
      select: { id: true, payTransactionId: true, orderId: true, amountCents: true },
    });
    const localByTrade = new Map(localPayments.map((p) => [p.payTransactionId, p]));
    const localAmountCents = localPayments.reduce((s, p) => s + p.amountCents, 0);

    const items: Array<{
      tradeNo: string;
      paymentId?: string;
      orderId?: string;
      diffType: string;
      channelAmountCents: number;
      localAmountCents: number;
      note?: string;
    }> = [];

    for (const [tradeNo, g] of grouped) {
      const channelAmount = g.amounts[g.amounts.length - 1];
      const local = localByTrade.get(tradeNo);

      if (g.occurrences > 1) {
        items.push({
          tradeNo,
          paymentId: local?.id,
          orderId: local?.orderId,
          diffType: 'duplicate',
          channelAmountCents: channelAmount,
          localAmountCents: local?.amountCents ?? 0,
          note: `账单中同一交易号出现 ${g.occurrences} 次`,
        });
        continue;
      }

      if (local) {
        if (local.amountCents !== channelAmount) {
          items.push({
            tradeNo,
            paymentId: local.id,
            orderId: local.orderId,
            diffType: 'amount_mismatch',
            channelAmountCents: channelAmount,
            localAmountCents: local.amountCents,
            note: '渠道金额与本地支付金额不一致',
          });
        } else {
          items.push({
            tradeNo,
            paymentId: local.id,
            orderId: local.orderId,
            diffType: 'matched',
            channelAmountCents: channelAmount,
            localAmountCents: local.amountCents,
          });
        }
        continue;
      }

      // 本地没有这笔支付: 尽力用订单号挂上订单, 方便处置时直接跳转
      let orderId: string | undefined;
      if (g.orderNo) {
        const order = await this.prisma.order.findUnique({
          where: { orderNo: g.orderNo },
          select: { id: true },
        });
        orderId = order?.id;
      }
      items.push({
        tradeNo,
        orderId,
        diffType: 'missing_local',
        channelAmountCents: channelAmount,
        localAmountCents: 0,
        note: g.orderNo ? `渠道订单号 ${g.orderNo}` : '渠道有记录, 本地无对应支付',
      });
    }

    // 本地有、渠道账单没有
    for (const p of localPayments) {
      if (!p.payTransactionId || grouped.has(p.payTransactionId)) continue;
      items.push({
        tradeNo: p.payTransactionId,
        paymentId: p.id,
        orderId: p.orderId,
        diffType: 'missing_channel',
        channelAmountCents: 0,
        localAmountCents: p.amountCents,
        note: '本地已记支付成功, 渠道账单中无此交易',
      });
    }

    const diffCount = items.filter((i) => i.diffType !== 'matched').length;

    const batch = await this.prisma.reconciliationBatch.create({
      data: {
        channel,
        billDate: input.billDate,
        fileName: input.fileName ?? null,
        channelCount: dataRows.filter((r) => (r[idx.tradeNo] ?? '').trim()).length,
        channelAmountCents,
        localCount: localPayments.length,
        localAmountCents,
        matchedCount: items.length - diffCount,
        diffCount,
        operatorId: input.operatorId,
      },
    });

    // 逐条写入: 单批可能上千行, 用 createMany 更快, 但 SQLite 上逐条
    // 写入在千行量级仍是毫秒级, 换来的是单行失败可定位到具体交易号
    for (const it of items) {
      await this.prisma.reconciliationItem.create({
        data: {
          batchId: batch.id,
          tradeNo: it.tradeNo,
          orderId: it.orderId,
          diffType: it.diffType,
          channelAmountCents: it.channelAmountCents,
          localAmountCents: it.localAmountCents,
          note: it.note,
          // 一致的行不需要处置, 直接置为已处理
          status: it.diffType === 'matched' ? 'resolved' : 'open',
          resolvedAt: it.diffType === 'matched' ? new Date() : null,
        },
      });
    }

    this.logger.log(
      `对账导入: ${channel} ${input.billDate} 共 ${items.length} 行, 差异 ${diffCount} 条`,
    );
    return this.batchDetail(batch.id);
  }

  async listBatches(query: {
    limit?: number;
    offset?: number;
    channel?: string;
    status?: string;
    from?: string;
    to?: string;
  } = {}) {
    const take = Math.min(Math.max(Number(query.limit) || 20, 1), 100);
    const skip = Math.max(Number(query.offset) || 0, 0);
    const where = {
      ...(query.channel ? { channel: query.channel } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.from || query.to
        ? {
            billDate: {
              ...(query.from ? { gte: query.from } : {}),
              ...(query.to ? { lte: query.to } : {}),
            },
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.reconciliationBatch.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take,
        skip,
      }),
      this.prisma.reconciliationBatch.count({ where }),
    ]);
    return { items, total };
  }

  async batchDetail(id: string) {
    const batch = await this.prisma.reconciliationBatch.findUnique({ where: { id } });
    if (!batch) throw new AppError(40400, '对账批次不存在', 404);
    const items = await this.prisma.reconciliationItem.findMany({
      where: { batchId: id },
      orderBy: [{ diffType: 'asc' }, { tradeNo: 'asc' }],
      take: 2000,
    });
    return { batch, items };
  }

  /** 处置差异: 只改状态与备注 */
  async resolveItem(
    id: string,
    params: { status: 'resolved' | 'ignored'; note: string },
    operatorId: string,
  ) {
    const item = await this.prisma.reconciliationItem.findUnique({ where: { id } });
    if (!item) throw new AppError(40400, '对账差异不存在', 404);
    if (item.diffType === 'matched') {
      throw new AppError(40001, '一致的行无需处置', 400);
    }
    if (item.status !== 'open') {
      throw new AppError(40901, '该差异已处置', 409);
    }
    if (!params.note || !params.note.trim()) {
      throw new AppError(40001, '请填写处置说明', 400);
    }

    const updated = await this.prisma.reconciliationItem.update({
      where: { id },
      data: {
        status: params.status,
        note: params.note.trim(),
        resolvedBy: operatorId,
        resolvedAt: new Date(),
      },
    });

    // 全部差异处置完毕 → 批次置为 resolved
    const openLeft = await this.prisma.reconciliationItem.count({
      where: { batchId: item.batchId, status: 'open', diffType: { not: 'matched' } },
    });
    if (openLeft === 0) {
      await this.prisma.reconciliationBatch.update({
        where: { id: item.batchId },
        data: { status: 'resolved' },
      });
    }

    return updated;
  }

  /** 批次差异导出 (CSV, 含 BOM)。matced 行也导出, 便于整体核对 */
  async exportItems(batchId: string): Promise<string> {
    const detail = await this.batchDetail(batchId);
    return toCsv(
      [
        { label: '交易号', value: (r) => r.tradeNo },
        { label: '订单ID', value: (r) => r.orderId ?? '' },
        { label: '差异类型', value: (r) => r.diffType },
        { label: '渠道金额(分)', value: (r) => r.channelAmountCents },
        { label: '本地金额(分)', value: (r) => r.localAmountCents },
        { label: '状态', value: (r) => r.status },
        { label: '备注', value: (r) => r.note ?? '' },
        { label: '处置人', value: (r) => r.resolvedBy ?? '' },
      ],
      detail.items,
    );
  }
}

function findIndex(header: string[], keys: string[]): number {
  const lowered = keys.map((k) => k.toLowerCase());
  return header.findIndex((h) => lowered.includes(h));
}

/**
 * 金额解析。
 *
 * `amountIsCents` 为 false 时按元解析并四舍五入到分 —— 渠道账单普遍用元。
 * 含小数点的一律按元处理: 分是整数, 出现小数说明列名与实际口径不符。
 */
function parseAmount(raw: string | undefined, amountIsCents: boolean): number {
  const text = (raw ?? '').trim().replace(/,/g, '');
  if (!text) return NaN;
  if (text.includes('.') || !amountIsCents) {
    return Math.round(Number(text) * 100);
  }
  return Math.round(Number(text));
}
