/**
 * 后台账单与调用记录接口。
 *
 *   · `GET  /admin/billing-orders`              生成账单列表（筛选：状态 / 用户 / 任务 / 模型 / 渠道 / 分组 / 时间）
 *   · `GET  /admin/billing-orders/:id`          账单详情
 *   · `POST /admin/billing-orders/:id/resolve`  人工核对（settle | refund，高危）
 *   · `GET  /admin/api-logs`                    上游调用记录（`ApiCallLog`）
 *   · `GET  /admin/api-logs/:id`                单条调用详情（含请求 / 响应报文）
 *   · `GET  /admin/api-logs/export`             调用记录 CSV（不含报文）
 *
 * 页面在 `/admin/model-calls`，走 `/admin/api-logs` —— 不能复用旧
 * `AdminModelCallsController` 的 `admin/model-calls` 路径：那套读的是旧
 * `ModelCallLog`，P6 随 `src/providers/**` 一起删除，两条链路共用同一路径会互相遮蔽。
 */

import { Body, Controller, Get, Param, Post, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import { AdminUser, RequireAllPermissions, RequirePermission } from "../../admin/admin.decorator";
import type { AdminUser as AdminUserContext } from "../../admin/admin.decorator";
import { PERMISSIONS } from "../../admin/permissions";
import { sendCsv } from "../../common/csv-response";
import { BillingAdminService } from "./billing-admin.service";
import {
  ApiLogListQueryDto,
  BillingBatchResolveBodyDto,
  BillingOrderListQueryDto,
  BillingResolveBodyDto,
} from "./dto/billing-admin.dto";

@Controller("admin/billing-orders")
export class AdminBillingOrdersController {
  constructor(private readonly billing: BillingAdminService) {}

  @Get()
  @RequirePermission(PERMISSIONS.billingOrderRead)
  list(@Query() query: BillingOrderListQueryDto) {
    return this.billing.listOrders(query);
  }

  @Get(":id")
  @RequirePermission(PERMISSIONS.billingOrderRead)
  get(@Param("id") id: string) {
    return this.billing.getOrder(id);
  }

  /**
   * 高危动作：需要明确处置结果与原因。
   * 金额口径完全由 `BillingService.resolve` 决定。
   */
  @Post(":id/resolve")
  @RequirePermission(PERMISSIONS.billingOrderResolve)
  resolve(
    @Param("id") id: string,
    @Body() body: BillingResolveBodyDto,
    @AdminUser() user: AdminUserContext,
  ) {
    return this.billing.resolveOrder(
      id,
      body?.action,
      user?.id ?? "",
      body?.reason,
    );
  }

  /**
   * 批量核对：一次处理多张待核对账单。
   *
   * 逐条独立处置 —— 一张失败不影响其余：批量场景常常是「同一批挂账」，
   * 其中一两条状态已经变了就整批重试会很烦。返回每条的结果，失败原因逐条可读。
   */
  @Post("batch-resolve")
  @RequirePermission(PERMISSIONS.billingOrderResolve)
  async batchResolve(
    @Body() body: BillingBatchResolveBodyDto,
    @AdminUser() user: AdminUserContext,
  ) {
    const ids = String(body?.ids ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item !== "");
    return this.billing.batchResolveOrders(
      ids,
      body?.action,
      user?.id ?? "",
      body?.reason,
    );
  }
}

@Controller("admin/api-logs")
export class AdminApiLogsController {
  constructor(private readonly billing: BillingAdminService) {}

  @Get()
  @RequirePermission(PERMISSIONS.modelCallRead)
  list(@Query() query: ApiLogListQueryDto) {
    return this.billing.listApiLogs(query);
  }

  /**
   * 导出调用记录（CSV）。
   *
   * 导出把用户数据带出系统，使用独立的 `data.export` 权限点 —— 与任务
   * 导出同一口径。筛选与列表共用同一份 DTO，不会出现两个口径。
   * CSV 文件流直接写响应，不能走统一信封。
   */
  @Get("export")
  @RequireAllPermissions(PERMISSIONS.modelCallRead, PERMISSIONS.dataExport)
  async export(
    @Query() query: ApiLogListQueryDto,
    @Res() res: Response,
  ) {
    const csv = await this.billing.exportApiLogsCsv(query);
    sendCsv(res, "api-logs", csv);
  }

  /**
   * 单条调用详情（含请求 / 响应报文）。
   *
   * 必须声明在 `export` 之后：`export` 也是单个路径段，若 `:id` 在前，
   * 导出请求会先命中这里、把 "export" 当作 id 去查。
   */
  @Get(":id")
  @RequirePermission(PERMISSIONS.modelCallRead)
  detail(@Param("id") id: string) {
    return this.billing.getApiLog(id);
  }
}
