import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Response } from 'express';
import { IsIn, IsString, MaxLength } from 'class-validator';
import { AdminUser, AuditAction, RequirePermission, type AdminUser as AdminUserType } from './admin.decorator';
import { PERMISSIONS } from './permissions';
import { AdminReconciliationService } from './reconciliation.service';
import { AppError } from '../common/app.exception';
import { sendCsv } from '../common/csv-response';

export class ResolveDiffDto {
  @IsIn(['resolved', 'ignored'], { message: '处置结果只能是 resolved 或 ignored' })
  status!: 'resolved' | 'ignored';

  /** 处置说明 —— 对账差异的每一笔都要能回答「为什么这么处理」 */
  @IsString()
  @MaxLength(300)
  note!: string;
}

/**
 * 渠道对账。
 *
 * 权限: 读取用 `payment.read` (运营排障也要看), 导入与处置用
 * `finance.reconcile` (只给财务) —— 处置会关闭差异, 让「账对不上」从
 * 看板上消失, 这是财务口径的责任, 不能让运营代劳。
 */
@Controller('admin/reconciliation')
export class AdminReconciliationController {
  constructor(private readonly reconciliation: AdminReconciliationService) {}

  @Get('batches')
  @RequirePermission(PERMISSIONS.paymentRead)
  batches(@Query('limit') limit?: string, @Query('offset') offset?: string) {
    return this.reconciliation.listBatches(Number(limit) || 20, Number(offset) || 0);
  }

  @Get('batches/:id')
  @RequirePermission(PERMISSIONS.paymentRead)
  batch(@Param('id') id: string) {
    return this.reconciliation.batchDetail(id);
  }

  /** 差异清单导出。导出即把交易数据带出系统, 与其它导出一致留审计 */
  @Get('batches/:id/export')
  @RequirePermission(PERMISSIONS.dataExport)
  @AuditAction('data.export')
  async export(@Param('id') id: string, @Res() res: Response) {
    const csv = await this.reconciliation.exportItems(id);
    sendCsv(res, 'reconciliation', csv);
  }

  /**
   * 导入渠道账单 (multipart: file + channel + billDate)。
   *
   * 内存存储而非落盘: 账单文件只在导入瞬间有用, 落盘反而会留下
   * 一份含交易号的明文文件需要额外的清理与权限管理。
   */
  @Post('import')
  @RequirePermission(PERMISSIONS.financeReconcile)
  @AuditAction('finance.reconciliation_import')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 5 * 1024 * 1024 },
    }),
  )
  import(
    @UploadedFile() file: { buffer?: Buffer; originalname?: string },
    @Body('channel') channel: string,
    @Body('billDate') billDate: string,
    @AdminUser() admin: AdminUserType,
  ) {
    if (!file?.buffer?.length) {
      throw new AppError(40001, '请上传对账文件 (字段名 file)', 400);
    }
    return this.reconciliation.importBatch({
      channel,
      billDate,
      fileName: file.originalname,
      csv: file.buffer.toString('utf8'),
      operatorId: admin.id,
    });
  }

  @Post('items/:id/resolve')
  @RequirePermission(PERMISSIONS.financeReconcile)
  @AuditAction('finance.reconciliation_resolve')
  resolve(
    @Param('id') id: string,
    @Body() dto: ResolveDiffDto,
    @AdminUser() admin: AdminUserType,
  ) {
    return this.reconciliation.resolveItem(id, dto, admin.id);
  }
}
