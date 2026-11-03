import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Response } from 'express';
import { AdminUser, AuditAction, RequirePermission, type AdminUser as AdminUserType } from '../admin.decorator';
import { PERMISSIONS } from '../permissions';
import { AdminPaymentsService } from './payment-admin.service';
import { PaymentOrderService } from '../../payments/payment-order.service';
import { PaymentReconciliationService } from '../../payments/payment-reconciliation.service';
import { PaymentConfigService } from '../../payments/payment-config.service';
import { AdminSettingsService } from '../settings.service';
import {
  PaymentOrderActionDto,
  PaymentOrderListQueryDto,
  PaymentProductSaveDto,
  PaymentProviderConfigUpdateDto,
  PaymentSettingsUpdateDto,
  ReconciliationImportDto,
  ReconciliationItemsQueryDto,
  ReconciliationListQueryDto,
  ReconciliationRunDto,
} from '../dto/payment-admin.dto';
import { AppError } from '../../common/app.exception';
import { sendCsv } from '../../common/csv-response';
import { toCsv } from '../../common/csv';
import { formatShanghai } from '../../payments/payment-query';

/**
 * 后台「支付充值」—— 渠道配置、站点币种、充值商品。
 *
 * 权限口径：
 *   · 读取  `payment.read`
 *   · 保存渠道配置 `payment.write`（高危，写审计）
 *   · 商品编辑 `product.write`
 */
@Controller('admin/payments')
export class AdminPaymentConfigController {
  constructor(
    private readonly admin: AdminPaymentsService,
    private readonly configs: PaymentConfigService,
    private readonly settings: AdminSettingsService,
  ) {}

  @Get('providers')
  @RequirePermission(PERMISSIONS.paymentRead)
  async providers() {
    const items = await this.configs.listAdmin();
    return { items, total: items.length, page: 1, pageSize: items.length };
  }

  @Put('providers/:providerId/config')
  @RequirePermission(PERMISSIONS.paymentWrite)
  @AuditAction('payment.provider_config_save')
  saveProvider(
    @Param('providerId') providerId: string,
    @Body() dto: PaymentProviderConfigUpdateDto,
    @AdminUser() admin: AdminUserType,
  ) {
    return this.configs.saveVersion(
      providerId,
      { enabled: dto.enabled, closeAfterMinutes: dto.closeAfterMinutes, values: dto.values },
      admin.id,
    );
  }

  @Get('settings')
  @RequirePermission(PERMISSIONS.paymentRead)
  settingsView() {
    return this.admin.settingsView();
  }

  @Put('settings')
  @RequirePermission(PERMISSIONS.paymentWrite)
  @AuditAction('payment.settings_save')
  async saveSettings(@Body() dto: PaymentSettingsUpdateDto, @AdminUser() admin: AdminUserType) {
    await this.settings.updateAll(
      { 'payment.defaultCurrency': dto.defaultCurrency },
      [],
      admin.id,
      dto.reason,
    );
    return this.admin.settingsView();
  }

  @Get('products')
  @RequirePermission(PERMISSIONS.productRead)
  products() {
    return this.admin.products();
  }

  @Post('products')
  @RequirePermission(PERMISSIONS.productWrite)
  @AuditAction('payment.product_create')
  createProduct(@Body() dto: PaymentProductSaveDto) {
    return this.admin.saveProduct(null, dto as unknown as Record<string, unknown>);
  }

  @Put('products/:id')
  @RequirePermission(PERMISSIONS.productWrite)
  @AuditAction('payment.product_update')
  updateProduct(@Param('id') id: string, @Body() dto: PaymentProductSaveDto) {
    return this.admin.saveProduct(id, dto as unknown as Record<string, unknown>);
  }
}

/**
 * 后台「支付订单」—— 列表、详情、查单、关单、导出。
 *
 * 查单/关单用 `payment.operate`：它只推进渠道已经发生的事实，不能凭空造钱，
 * 因此不是高危权限；但每次仍写普通审计。
 */
@Controller('admin/payments/orders')
export class AdminPaymentOrdersController {
  constructor(
    private readonly admin: AdminPaymentsService,
    private readonly orders: PaymentOrderService,
  ) {}

  @Get()
  @RequirePermission(PERMISSIONS.orderRead)
  list(@Query() query: PaymentOrderListQueryDto) {
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

  @Get('export.csv')
  @RequirePermission(PERMISSIONS.dataExport)
  @AuditAction('data.export')
  async export(@Query() query: PaymentOrderListQueryDto, @Res() res: Response) {
    const rows = await this.admin.ordersForExport({
      status: query.status,
      keyword: query.keyword,
      providerId: query.providerId,
      timeField: query.timeField,
      from: query.from,
      to: query.to,
      sort: query.sort,
    });
    const csv = toCsv(
      [
        { label: '订单号', value: (r) => r.orderNo },
        { label: '用户ID', value: (r) => r.userId },
        { label: '用户名', value: (r) => r.user?.name ?? '' },
        { label: '用户邮箱', value: (r) => r.user?.email ?? '' },
        { label: '商品', value: (r) => r.productName },
        { label: '渠道', value: (r) => r.providerId },
        { label: '金额(分)', value: (r) => r.amountCents },
        { label: '币种', value: (r) => r.currency },
        { label: '权益(积分)', value: (r) => r.credits },
        { label: '状态', value: (r) => r.status },
        { label: '配置版本', value: (r) => r.providerConfigVersion ?? '' },
        { label: '渠道交易号', value: (r) => r.providerTradeNo ?? '' },
        { label: '创建时间', value: (r) => formatShanghai(new Date(r.createdAt)) },
        { label: '支付时间', value: (r) => formatShanghai(r.providerPaidAt ? new Date(r.providerPaidAt) : null) },
        { label: '入账时间', value: (r) => formatShanghai(r.creditedAt ? new Date(r.creditedAt) : null) },
        { label: '关闭时间', value: (r) => formatShanghai(r.closedAt ? new Date(r.closedAt) : null) },
      ],
      rows,
    );
    sendCsv(res, '支付订单', csv);
  }

  @Get(':id')
  @RequirePermission(PERMISSIONS.orderRead)
  detail(@Param('id') id: string) {
    return this.admin.orderDetail(id);
  }

  @Post(':id/query')
  @RequirePermission(PERMISSIONS.paymentOperate)
  @AuditAction('payment.order_query')
  async query(@Param('id') id: string, @AdminUser() admin: AdminUserType) {
    const view = await this.orders.query({ orderId: id, actor: { kind: 'admin', adminId: admin.id } });
    return { order: { id: view.orderId, status: view.displayStatus }, changed: false, idempotentHit: false, view };
  }

  @Post(':id/close')
  @RequirePermission(PERMISSIONS.paymentOperate)
  @AuditAction('payment.order_close')
  async close(@Param('id') id: string, @Body() dto: PaymentOrderActionDto, @AdminUser() admin: AdminUserType) {
    const view = await this.orders.close({
      orderId: id,
      actor: { kind: 'admin', adminId: admin.id },
      reason: dto.reason,
    });
    return { order: { id: view.orderId, status: view.displayStatus }, view };
  }
}

/**
 * 后台「支付对账」—— 执行、列表、明细、导入、导出。
 */
@Controller('admin/payments/reconciliations')
export class AdminPaymentReconciliationController {
  constructor(
    private readonly admin: AdminPaymentsService,
    private readonly reconciliation: PaymentReconciliationService,
  ) {}

  @Post()
  @RequirePermission(PERMISSIONS.financeReconcile)
  @AuditAction('payment.reconciliation_run')
  async run(@Body() dto: ReconciliationRunDto, @AdminUser() admin: AdminUserType) {
    return this.reconciliation.run({
      providerId: dto.providerId,
      billDate: dto.billDate,
      retryFailed: dto.retryFailed,
      actorId: admin.id,
      reason: dto.reason,
    });
  }

  @Get()
  @RequirePermission(PERMISSIONS.paymentRead)
  list(@Query() query: ReconciliationListQueryDto) {
    return this.reconciliation.list({
      providerId: query.providerId,
      status: query.status,
      from: query.from,
      to: query.to,
      page: query.page,
      pageSize: query.pageSize,
    });
  }

  @Get('export.csv')
  @RequirePermission(PERMISSIONS.dataExport)
  @AuditAction('data.export')
  async exportRuns(@Query() query: ReconciliationListQueryDto, @Res() res: Response) {
    const rows = await this.reconciliation.runsForExport({
      providerId: query.providerId,
      status: query.status,
      from: query.from,
      to: query.to,
    });
    const csv = toCsv(
      [
        { label: '账单日期', value: (r) => r.billDate },
        { label: '渠道', value: (r) => r.providerId },
        { label: '执行次数', value: (r) => r.attempt },
        { label: '状态', value: (r) => r.status },
        { label: '总笔数', value: (r) => r.totalItems },
        { label: '一致', value: (r) => r.matchItems },
        { label: '自动补发', value: (r) => r.recoveredItems },
        { label: '异常', value: (r) => r.errorItems },
        { label: '错误', value: (r) => r.error ?? '' },
        { label: '开始时间', value: (r) => formatShanghai(r.startedAt) },
        { label: '完成时间', value: (r) => formatShanghai(r.completedAt) },
      ],
      rows,
    );
    sendCsv(res, '支付对账', csv);
  }

  @Get(':id/items/export.csv')
  @RequirePermission(PERMISSIONS.dataExport)
  @AuditAction('data.export')
  async exportItems(@Param('id') id: string, @Query('result') result: string | undefined, @Res() res: Response) {
    const rows = await this.reconciliation.itemsForExport(id, result);
    const csv = toCsv(
      [
        { label: '结果', value: (r) => r.result },
        { label: '商户订单号', value: (r) => r.merchantOrderNo },
        { label: '渠道交易号', value: (r) => r.providerTradeNo ?? '' },
        { label: '金额(分)', value: (r) => r.amountCents },
        { label: '币种', value: (r) => r.currency },
        { label: '说明', value: (r) => r.detail ?? '' },
      ],
      rows,
    );
    sendCsv(res, '支付对账明细', csv);
  }

  @Get(':id/items')
  @RequirePermission(PERMISSIONS.paymentRead)
  items(@Param('id') id: string, @Query() query: ReconciliationItemsQueryDto) {
    return this.reconciliation.items(id, {
      result: query.result,
      page: query.page,
      pageSize: query.pageSize,
    });
  }

  @Post('import')
  @RequirePermission(PERMISSIONS.financeReconcile)
  @AuditAction('payment.reconciliation_import')
  @UseInterceptors(
    FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } }),
  )
  async import(
    @UploadedFile() file: { buffer?: Buffer; originalname?: string },
    @Body() dto: ReconciliationImportDto,
    @AdminUser() admin: AdminUserType,
  ) {
    if (!file?.buffer?.length) throw new AppError(40001, '请上传对账单文件 (字段名 file)', 400);
    const name = file.originalname ?? 'bill.csv';
    const isCsv = /\.csv$/i.test(name);
    const isAlipayZip = /\.zip$/i.test(name) && dto.providerId === 'alipay';
    if (!isCsv && !isAlipayZip) {
      throw new AppError(40001, '对账单只支持 .csv，或支付宝渠道的 .zip', 400);
    }
    return this.reconciliation.importCsv({
      providerId: dto.providerId,
      billDate: dto.billDate,
      file: file.buffer,
      fileName: name,
      actorId: admin.id,
      reason: dto.reason,
    });
  }
}
