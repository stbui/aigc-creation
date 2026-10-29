import { Injectable, Logger } from '@nestjs/common';
import { AppError } from '../common/app.exception';
import { CSV_EXPORT_MAX_ROWS, centsToYuan, toCsv } from '../common/csv';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { EmailService } from '../channels/email/email.service';
import { escapeHtml } from '../channels/template';

/**
 * 发票 (B3)。
 *
 * 规则:
 *   · 一单一票 (`Invoice.orderId @unique`)
 *   · 只有**已支付**的订单可申请; 金额取 `paidCents - refundedCents` 的
 *     申请时快照 —— 开票之后再退款, 票面金额不会自己变
 *   · 企业抬头必须给纳税人识别号, 否则票开出来不能用, 退回来重开是纯损耗
 *   · C 端只能申请; 开具 / 驳回在后台 (`invoice.write` 权限)
 *
 * 为什么文件是 HTML 而不是 PDF: 项目零新增依赖, 手写 PDF 的字体嵌入
 * 与中文排版风险远大于收益。可打印的 HTML 用浏览器「打印为 PDF」即可
 * 得到同样的交付物, 且开具后随时可按最新抬头重渲染。
 */
@Injectable()
export class InvoicesService {
  private readonly logger = new Logger(InvoicesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly email: EmailService,
  ) {}

  // ── C 端 ──────────────────────────────────────────────────────────

  async create(
    userId: string,
    dto: {
      orderId: string;
      kind: 'personal' | 'company';
      title: string;
      taxNo?: string;
      email?: string;
      content?: string;
    },
  ) {
    const order = await this.prisma.order.findUnique({ where: { id: dto.orderId } });
    if (!order) throw new AppError(40400, '订单不存在', 404);
    if (order.userId !== userId) throw new AppError(40301, '无权为该订单开票', 403);
    if (order.status !== 'paid' && order.status !== 'partial_refunded') {
      throw new AppError(40901, '仅已支付的订单可申请开票', 409);
    }

    const amountCents = order.paidCents - order.refundedCents;
    if (amountCents <= 0) {
      throw new AppError(40901, '该订单已无可开票金额', 409);
    }

    const title = (dto.title ?? '').trim();
    if (!title) throw new AppError(40001, '请填写发票抬头', 400);
    if (dto.kind === 'company' && !(dto.taxNo ?? '').trim()) {
      throw new AppError(40001, '企业抬头必须填写纳税人识别号', 400);
    }

    const existing = await this.prisma.invoice.findUnique({ where: { orderId: order.id } });
    if (existing) {
      throw new AppError(40901, `该订单已申请过发票 (${existing.invoiceNo})`, 409);
    }

    const invoice = await this.prisma.invoice.create({
      data: {
        invoiceNo: await this.nextInvoiceNo(),
        orderId: order.id,
        userId,
        amountCents,
        kind: dto.kind,
        title,
        taxNo: (dto.taxNo ?? '').trim() || null,
        email: (dto.email ?? '').trim() || null,
        content: (dto.content ?? '').trim() || '技术服务费',
      },
    });

    this.logger.log(`发票申请: ${invoice.invoiceNo} 订单 ${order.orderNo} ${amountCents} 分`);
    return this.detail(invoice.id, userId);
  }

  async listByUser(userId: string, limit = 50) {
    const take = Math.min(Math.max(Number(limit) || 50, 1), 200);
    const [items, total] = await Promise.all([
      this.prisma.invoice.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take,
        include: { order: { select: { orderNo: true } } },
      }),
      this.prisma.invoice.count({ where: { userId } }),
    ]);
    return { items: items.map((i) => this.toView(i)), total };
  }

  async detail(id: string, userId?: string) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id },
      include: { order: { select: { orderNo: true } } },
    });
    if (!invoice) throw new AppError(40400, '发票不存在', 404);
    if (userId && invoice.userId !== userId) {
      throw new AppError(40301, '无权查看该发票', 403);
    }
    return this.toView(invoice);
  }

  /** 可打印 HTML。C 端本人 / 后台均可取 */
  async renderFile(id: string, opts: { userId?: string } = {}) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id },
      include: {
        order: { select: { orderNo: true, paidAt: true, paidCents: true, refundedCents: true } },
        user: { select: { name: true, email: true } },
      },
    });
    if (!invoice) throw new AppError(40400, '发票不存在', 404);
    if (opts.userId && invoice.userId !== opts.userId) {
      throw new AppError(40301, '无权查看该发票', 403);
    }
    if (invoice.status !== 'issued') {
      // 未开具的发票不能下载: 它还没有法律效力, 给出去只会引发「票是假的」质疑
      throw new AppError(40901, '发票尚未开具', 409);
    }
    return {
      html: await this.buildHtml(invoice),
      filename: `${invoice.invoiceNo}.html`,
    };
  }

  // ── 后台 ──────────────────────────────────────────────────────────

  async listForAdmin(query: { status?: string; keyword?: string; limit?: number; offset?: number }) {
    const take = Math.min(Math.max(Number(query.limit) || 20, 1), 200);
    const skip = Math.max(Number(query.offset) || 0, 0);
    const where = this.adminWhere(query);

    const [items, total] = await Promise.all([
      this.prisma.invoice.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take,
        skip,
        include: {
          order: { select: { orderNo: true } },
          user: { select: { email: true, name: true } },
        },
      }),
      this.prisma.invoice.count({ where }),
    ]);

    return {
      items: items.map((i) => ({
        ...this.toView(i),
        userEmail: i.user?.email ?? null,
        userName: i.user?.name ?? null,
      })),
      total,
    };
  }

  /**
   * 导出发票 (CSV)。
   *
   * 与后台列表共用 `adminWhere`，筛什么就导出什么。金额同时给分与元：
   * 财务按元核对，技术按分回查，两列都在才不用回头换算。
   */
  async exportCsvForAdmin(query: {
    status?: string;
    keyword?: string;
  }): Promise<string> {
    const rows = await this.prisma.invoice.findMany({
      where: this.adminWhere(query),
      orderBy: { createdAt: 'desc' },
      take: CSV_EXPORT_MAX_ROWS,
      include: {
        order: { select: { orderNo: true } },
        user: { select: { email: true, name: true } },
      },
    });

    return toCsv(
      [
        { label: '发票号', value: (r) => r.invoiceNo },
        { label: '订单号', value: (r) => r.order?.orderNo ?? r.orderId },
        { label: '申请邮箱', value: (r) => r.email ?? '' },
        { label: '用户邮箱', value: (r) => r.user?.email ?? '' },
        { label: '用户名称', value: (r) => r.user?.name ?? '' },
        { label: '抬头类型', value: (r) => (r.kind === 'company' ? '企业' : '个人') },
        { label: '抬头', value: (r) => r.title },
        { label: '税号', value: (r) => r.taxNo ?? '' },
        { label: '金额(分)', value: (r) => r.amountCents },
        { label: '金额(元)', value: (r) => centsToYuan(r.amountCents) },
        { label: '状态', value: (r) => r.status },
        { label: '驳回原因', value: (r) => r.rejectReason ?? '' },
        { label: '申请时间', value: (r) => r.createdAt },
        { label: '开具时间', value: (r) => r.issuedAt ?? '' },
      ],
      rows,
    );
  }

  /**
   * 后台列表与导出共用的筛选条件。
   *
   * 单独抽出避免「列表筛出 3 条、导出 4000 条」的口径分歧。
   */
  private adminWhere(query: { status?: string; keyword?: string }): Record<string, unknown> {
    const where: Record<string, unknown> = {};
    if (query.status) where.status = query.status;
    if (query.keyword) {
      where.OR = [
        { invoiceNo: { contains: query.keyword } },
        { title: { contains: query.keyword } },
        { order: { orderNo: { contains: query.keyword } } },
      ];
    }
    return where;
  }

  /**
   * 开具发票。
   *
   * 状态用条件更新抢占 (`updateMany({id, status:'pending'})`), 避免两个
   * 管理员同时点「开具」开出两张内容相同但状态各异的票。
   */
  async issue(id: string, operatorId: string, reason: string) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id },
      include: { order: { select: { orderNo: true } } },
    });
    if (!invoice) throw new AppError(40400, '发票不存在', 404);
    if (invoice.status !== 'pending') {
      throw new AppError(40901, `发票当前状态为 ${invoice.status}, 不可开具`, 409);
    }

    const html = await this.buildHtml(invoice);
    const key = this.storage.buildKey('invoices', 'html');
    let fileKey: string | null = null;
    try {
      await this.storage.getActive().put(key, Buffer.from(html, 'utf8'), 'text/html; charset=utf-8');
      fileKey = key;
    } catch (e) {
      // 文件落盘失败不阻断开具: 下载接口会按最新数据实时渲染
      this.logger.warn(`发票文件写入失败, 将按需实时渲染: ${(e as Error).message}`);
    }

    const claimed = await this.prisma.invoice.updateMany({
      where: { id, status: 'pending' },
      data: {
        status: 'issued',
        issuedAt: new Date(),
        issuedBy: operatorId,
        fileKey,
        rejectReason: null,
      },
    });
    if (claimed.count === 0) {
      throw new AppError(40901, '发票状态已被其它操作改变, 请刷新后重试', 409);
    }

    this.logger.log(
      `发票开具: ${invoice.invoiceNo} 订单 ${invoice.order?.orderNo} 操作人 ${operatorId} 原因: ${reason}`,
    );

    // 邮件通知为附带动作: 失败只记日志, 不影响「已开具」这一事实
    if (invoice.email) {
      void this.email
        .send({
          to: invoice.email,
          subject: `【货觉AI】发票已开具 ${invoice.invoiceNo}`,
          text:
            `您好，订单 ${invoice.order?.orderNo ?? ''} 的发票已开具。\n` +
            `发票号：${invoice.invoiceNo}\n金额：${(invoice.amountCents / 100).toFixed(2)} 元\n` +
            `可在「我的发票」页下载打印。`,
          html:
            `<p>您好，订单 ${escapeHtml(invoice.order?.orderNo ?? '')} 的发票已开具。</p>` +
            `<p>发票号：<strong>${escapeHtml(invoice.invoiceNo)}</strong><br/>` +
            `金额：${(invoice.amountCents / 100).toFixed(2)} 元</p>` +
            `<p>可在「我的发票」页下载打印。</p>`,
        })
        .then((r) => {
          if (!r.ok) this.logger.warn(`发票邮件投递失败: ${r.error ?? 'unknown'}`);
        });
    }

    return this.detail(id);
  }

  async reject(id: string, operatorId: string, reason: string) {
    const invoice = await this.prisma.invoice.findUnique({ where: { id } });
    if (!invoice) throw new AppError(40400, '发票不存在', 404);
    if (invoice.status !== 'pending') {
      throw new AppError(40901, `发票当前状态为 ${invoice.status}, 不可驳回`, 409);
    }
    const claimed = await this.prisma.invoice.updateMany({
      where: { id, status: 'pending' },
      data: { status: 'rejected', rejectReason: reason, issuedBy: operatorId },
    });
    if (claimed.count === 0) {
      throw new AppError(40901, '发票状态已被其它操作改变, 请刷新后重试', 409);
    }
    this.logger.log(`发票驳回: ${invoice.invoiceNo} 操作人 ${operatorId} 原因: ${reason}`);
    return this.detail(id);
  }

  // ── 内部 ──────────────────────────────────────────────────────────

  /** 发票号: HX + yyyymmdd + 6 位流水。唯一约束兜底并发冲突 */
  private async nextInvoiceNo(): Promise<string> {
    const d = new Date();
    const day = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(
      d.getDate(),
    ).padStart(2, '0')}`;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const count = await this.prisma.invoice.count({
        where: { invoiceNo: { startsWith: `HX${day}` } },
      });
      const no = `HX${day}${String(count + 1 + attempt).padStart(6, '0')}`;
      const exists = await this.prisma.invoice.findUnique({ where: { invoiceNo: no } });
      if (!exists) return no;
    }
    return `HX${day}${String(Date.now()).slice(-6)}`;
  }

  private toView(i: {
    id: string;
    invoiceNo: string;
    orderId: string;
    amountCents: number;
    kind: string;
    title: string;
    taxNo: string | null;
    email: string | null;
    content: string;
    status: string;
    rejectReason: string | null;
    issuedAt: Date | null;
    createdAt: Date;
    fileKey?: string | null;
    order?: { orderNo: string } | null;
  }) {
    return {
      id: i.id,
      invoiceNo: i.invoiceNo,
      orderId: i.orderId,
      orderNo: i.order?.orderNo ?? null,
      amountCents: i.amountCents,
      kind: i.kind,
      title: i.title,
      taxNo: i.taxNo,
      email: i.email,
      content: i.content,
      status: i.status,
      rejectReason: i.rejectReason,
      issuedAt: i.issuedAt,
      createdAt: i.createdAt,
      fileUrl: i.status === 'issued' ? `/api/v1/invoices/${i.id}/file` : null,
      hasStoredFile: Boolean(i.fileKey),
    };
  }

  /** 可打印 HTML (内联样式: 不依赖外部 CSS, 打印时不会丢样式) */
  private async buildHtml(invoice: {
    invoiceNo: string;
    amountCents: number;
    kind: string;
    title: string;
    taxNo: string | null;
    content: string;
    issuedAt: Date | null;
    createdAt: Date;
    order?: { orderNo: string } | null;
  }): Promise<string> {
    const fmt = (cents: number) => (cents / 100).toFixed(2);
    const date = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : '-');
    const title = escapeHtml(invoice.title);
    const taxNo = escapeHtml(invoice.taxNo ?? '—');
    const content = escapeHtml(invoice.content);
    const no = escapeHtml(invoice.invoiceNo);
    const orderNo = escapeHtml(invoice.order?.orderNo ?? '');
    const issued = date(invoice.issuedAt ?? invoice.createdAt);

    return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>电子发票 ${no}</title>
<style>
  @page { size: A4; margin: 18mm; }
  body { font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; color: #171a2b; margin: 0; }
  .wrap { max-width: 720px; margin: 0 auto; padding: 24px; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  .sub { color: #667085; font-size: 12px; margin-bottom: 24px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 16px; font-size: 13px; }
  th, td { border: 1px solid #e5e7ef; padding: 8px 10px; text-align: left; }
  th { background: #f2f4f7; width: 96px; color: #4e5969; font-weight: 500; }
  .amount { font-size: 18px; font-weight: 600; color: #5546d8; }
  .foot { color: #86909c; font-size: 12px; line-height: 1.7; margin-top: 24px; }
  @media print { .noprint { display: none; } }
</style>
</head>
<body>
<div class="wrap">
  <h1>电子发票（普通发票）</h1>
  <div class="sub">发票号 ${no} · 开票日期 ${issued}</div>
  <table>
    <tr><th>购买方</th><td>${title}</td></tr>
    <tr><th>纳税人识别号</th><td>${taxNo}</td></tr>
    <tr><th>开票类型</th><td>${invoice.kind === 'company' ? '企业' : '个人'}</td></tr>
    <tr><th>项目名称</th><td>${content}</td></tr>
    <tr><th>关联订单</th><td>${orderNo}</td></tr>
    <tr><th>价税合计</th><td class="amount">￥${fmt(invoice.amountCents)}</td></tr>
  </table>
  <div class="foot">
    本发票由货觉AI 开具，对应订单 ${orderNo}。<br/>
    本文件为可打印凭证，使用浏览器「打印为 PDF」即可得到 PDF 版本。
  </div>
</div>
</body>
</html>`;
  }
}
