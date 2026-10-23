import { Body, Controller, Get, Param, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import {
  AdminUser,
  AuditAction,
  RequirePermission,
  type AdminUser as AdminUserType,
} from './admin.decorator';
import { PERMISSIONS } from './permissions';
import { InvoicesService } from '../invoices/invoices.service';

/** 开具发票: 必须写原因 (票面金额与抬头是财务凭证, 事后要能解释) */
export class IssueInvoiceDto {
  @IsString()
  @IsNotEmpty({ message: '请填写开具说明' })
  @MaxLength(300)
  reason!: string;
}

export class RejectInvoiceDto {
  @IsString()
  @IsNotEmpty({ message: '请填写驳回原因' })
  @MaxLength(300)
  reason!: string;
}

/**
 * 后台发票审核。
 *
 * 只给财务: `invoice.write`。开具是不可逆动作 (票号已占用, 抬头印在票上),
 * 驳回也不删记录 —— 驳回原因要能回到用户侧展示。
 */
@Controller('admin/invoices')
export class AdminInvoicesController {
  constructor(private readonly invoices: InvoicesService) {}

  @Get()
  @RequirePermission(PERMISSIONS.invoiceWrite)
  list(
    @Query('status') status?: string,
    @Query('keyword') keyword?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.invoices.listForAdmin({
      status: status || undefined,
      keyword: keyword || undefined,
      limit: Number(limit) || 20,
      offset: Number(offset) || 0,
    });
  }

  @Post(':id/issue')
  @RequirePermission(PERMISSIONS.invoiceWrite)
  @AuditAction('invoice.issue')
  issue(@Param('id') id: string, @Body() dto: IssueInvoiceDto, @AdminUser() admin: AdminUserType) {
    return this.invoices.issue(id, admin.id, dto.reason);
  }

  @Post(':id/reject')
  @RequirePermission(PERMISSIONS.invoiceWrite)
  @AuditAction('invoice.reject')
  reject(@Param('id') id: string, @Body() dto: RejectInvoiceDto, @AdminUser() admin: AdminUserType) {
    return this.invoices.reject(id, admin.id, dto.reason);
  }

  @Get(':id/file')
  @RequirePermission(PERMISSIONS.invoiceWrite)
  async file(@Param('id') id: string, @Res() res: Response) {
    const { html, filename } = await this.invoices.renderFile(id);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.send(html);
  }
}
