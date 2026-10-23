import { Body, Controller, Get, Param, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { CurrentUser, AuthUser } from '../common/current-user.decorator';
import { InvoicesService } from './invoices.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';

/** C 端发票: 只能申请与查看自己的发票 */
@Controller('invoices')
@UseGuards(JwtAuthGuard)
export class InvoicesController {
  constructor(private readonly invoices: InvoicesService) {}

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateInvoiceDto) {
    return this.invoices.create(user.id, dto);
  }

  @Get()
  list(@CurrentUser() user: AuthUser, @Query('limit') limit?: string) {
    return this.invoices.listByUser(user.id, Number(limit) || 50);
  }

  @Get(':id')
  detail(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.invoices.detail(id, user.id);
  }

  /**
   * 可打印 HTML。
   *
   * 用 @Res 直接返回, 不套统一响应信封 —— 它要作为 document 在新窗口打开,
   * 包一层 JSON 就变成下载了一个打不开的文件。
   */
  @Get(':id/file')
  async file(@Param('id') id: string, @CurrentUser() user: AuthUser, @Res() res: Response) {
    const { html, filename } = await this.invoices.renderFile(id, { userId: user.id });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    // inline: 直接预览 + 打印; filename 供浏览器另存
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.send(html);
  }
}
