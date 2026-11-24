import { Body, Controller, Get, Param, Post, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import { IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";
import { Transform } from "class-transformer";
import { AdminUser, RequireAllPermissions, RequirePermission, type AdminUser as AdminUserType } from "./admin.decorator";
import { PERMISSIONS } from "./permissions";
import { sendCsv } from "../common/csv-response";
import { InvoicesService } from "../invoices/invoices.service";

export class RejectInvoiceDto {
  @IsString()
  @IsNotEmpty({ message: "请填写驳回原因" })
  @MaxLength(300)
  reason!: string;
}

export class RedFlushInvoiceDto {
  @IsString()
  @IsNotEmpty({ message: "请填写冲红原因" })
  @MaxLength(300)
  reason!: string;
}

/** 发票列表查询。列表与导出共用 status/keyword 两个筛选, 口径一致 */
export class AdminInvoiceListQueryDto {
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() keyword?: string;

  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : Number(value)))
  @IsInt({ message: "limit 必须是整数" })
  @Min(1, { message: "limit 最小为 1" })
  @Max(200, { message: "limit 最大为 200" })
  limit?: number;

  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : Number(value)))
  @IsInt({ message: "offset 必须是整数" })
  @Min(0, { message: "offset 不能为负" })
  offset?: number;
}

/**
 * 后台发票审核。
 *
 * 只给财务: `invoice.write`。开具是不可逆动作 (票号已占用, 抬头印在票上),
 * 驳回也不删记录 —— 驳回原因要能回到用户侧展示。
 */
@Controller("admin/invoices")
export class AdminInvoicesController {
  constructor(private readonly invoices: InvoicesService) {}

  @Get()
  @RequirePermission(PERMISSIONS.invoiceWrite)
  list(@Query() query: AdminInvoiceListQueryDto) {
    return this.invoices.listForAdmin({
      status: query.status || undefined,
      keyword: query.keyword || undefined,
      limit: query.limit,
      offset: query.offset,
    });
  }

  @Post(":id/issue")
  @RequirePermission(PERMISSIONS.invoiceWrite)
  issue(@Param("id") id: string, @AdminUser() admin: AdminUserType) {
    return this.invoices.issue(id, admin.id);
  }

  @Post(":id/reject")
  @RequirePermission(PERMISSIONS.invoiceWrite)
  reject(
    @Param("id") id: string,
    @Body() dto: RejectInvoiceDto,
    @AdminUser() admin: AdminUserType,
  ) {
    return this.invoices.reject(id, admin.id, dto.reason);
  }

  @Post(":id/red-flush")
  @RequirePermission(PERMISSIONS.invoiceWrite)
  redFlush(
    @Param("id") id: string,
    @Body() dto: RedFlushInvoiceDto,
    @AdminUser() admin: AdminUserType,
  ) {
    return this.invoices.redFlush(id, admin.id, dto.reason);
  }

  /**
   * 导出发票 (CSV)。
   *
   * 导出把用户抬头与税号带出系统，使用独立的 `data.export` 权限点；
   * 列出口径与列表完全一致（同一 status / keyword）。
   * CSV 文件流直接写响应，不能走统一信封。
   */
  @Get("export")
  @RequireAllPermissions(PERMISSIONS.invoiceWrite, PERMISSIONS.dataExport)
  async export(@Res() res: Response, @Query() query: AdminInvoiceListQueryDto) {
    const csv = await this.invoices.exportCsvForAdmin({
      status: query.status || undefined,
      keyword: query.keyword || undefined,
    });
    sendCsv(res, "invoices", csv);
  }

  /** 发票 HTML 直接内联展示：浏览器需要原始文档，统一信封会把它包成 JSON */
  @Get(":id/file")
  @RequirePermission(PERMISSIONS.invoiceWrite)
  async file(@Param("id") id: string, @Res() res: Response) {
    const { html, filename } = await this.invoices.renderFile(id);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
    res.send(html);
  }
}
