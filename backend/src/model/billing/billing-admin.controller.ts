/**
 * 后台账单与调用记录接口。
 *
 *   · `GET  /admin/billing-orders`              生成账单列表（筛选：状态 / 用户 / 任务 / 模型 / 渠道 / 分组 / 时间）
 *   · `GET  /admin/billing-orders/:id`          账单详情
 *   · `POST /admin/billing-orders/:id/resolve`  人工核对（settle | refund，高危）
 *   · `GET  /admin/api-logs`                    上游调用记录（`ApiCallLog`）
 *
 * 页面在 `/admin/model-calls`，走 `/admin/api-logs` —— 不能复用旧
 * `AdminModelCallsController` 的 `admin/model-calls` 路径：那套读的是旧
 * `ModelCallLog`，P6 随 `src/providers/**` 一起删除，两条链路共用同一路径会互相遮蔽。
 */

import { Body, Controller, Get, Param, Post, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import { IsNotEmpty, IsString, MaxLength } from "class-validator";
import {
  AdminUser,
  AuditAction,
  RequireAllPermissions,
  RequirePermission,
} from "../../admin/admin.decorator";
import type { AdminUser as AdminUserContext } from "../../admin/admin.decorator";
import { PERMISSIONS } from "../../admin/permissions";
import { sendCsv } from "../../common/csv-response";
import {
  BillingAdminService,
  type ApiLogQuery,
  type BillingOrderQuery,
} from "./billing-admin.service";

/** 人工核对入参：动作只允许 settle / refund（语义校验在 service） */
export class BillingResolveBodyDto {
  @IsString() action: string;
  @IsString()
  @IsNotEmpty({ message: "请填写核对依据" })
  @MaxLength(500)
  reason: string;
}

/** 批量核对入参：单条失败不影响其它条目 */
export class BillingBatchResolveBodyDto {
  /** 单次最多核对的条数（与前端批量上限一致） */
  @IsString() ids?: string;
  @IsString() action?: string;
  @IsString()
  @IsNotEmpty({ message: "请填写核对依据" })
  @MaxLength(500)
  reason: string;
}

@Controller("admin/billing-orders")
export class AdminBillingOrdersController {
  constructor(private readonly billing: BillingAdminService) {}

  @Get()
  @RequirePermission(PERMISSIONS.billingOrderRead)
  list(
    @Query("status") status?: string,
    @Query("userId") userId?: string,
    @Query("taskId") taskId?: string,
    @Query("model") model?: string,
    @Query("channelId") channelId?: string,
    @Query("billingMode") billingMode?: string,
    @Query("group") group?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
  ) {
    const query: BillingOrderQuery = {
      status,
      userId,
      taskId,
      model,
      channelId,
      billingMode,
      group,
      from,
      to,
      page: numberOrUndefined(page),
      pageSize: numberOrUndefined(pageSize),
    };
    return this.billing.listOrders(query);
  }

  @Get(":id")
  @RequirePermission(PERMISSIONS.billingOrderRead)
  get(@Param("id") id: string) {
    return this.billing.getOrder(id);
  }

  /**
   * 高危动作：写审计。
   * 金额口径完全由 `BillingService.resolve` 决定。
   */
  @Post(":id/resolve")
  @RequirePermission(PERMISSIONS.billingOrderResolve)
  @AuditAction("billing_order.resolve")
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
  @AuditAction("billing_order.batch_resolve")
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
  list(@Query() raw: Record<string, string | undefined>) {
    return this.billing.listApiLogs(apiLogQueryOf(raw));
  }

  /**
   * 导出调用记录（CSV）。
   *
   * 导出把用户数据带出系统，用独立的 `data.export` 权限点并留审计 —— 与任务
   * 导出同一口径。筛选与列表共用 `apiLogQueryOf`，不会出现两个口径。
   */
  @Get("export")
  @RequireAllPermissions(PERMISSIONS.modelCallRead, PERMISSIONS.dataExport)
  @AuditAction("data.export")
  async export(
    @Query() raw: Record<string, string | undefined>,
    @Res() res: Response,
  ) {
    const csv = await this.billing.exportApiLogsCsv(apiLogQueryOf(raw));
    sendCsv(res, "api-logs", csv);
  }
}

/** 列表与导出共用的查询构造：两个入口必须解析出同一份筛选条件 */
function apiLogQueryOf(raw: Record<string, string | undefined>): ApiLogQuery {
  return {
    status: raw.status,
    requestKind: raw.requestKind,
    channelId: raw.channelId,
    taskId: raw.taskId,
    userId: raw.userId,
    model: raw.model,
    billable: raw.billable,
    from: raw.from,
    to: raw.to,
    page: numberOrUndefined(raw.page),
    pageSize: numberOrUndefined(raw.pageSize),
  };
}

function numberOrUndefined(value: string | undefined): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : undefined;
}
