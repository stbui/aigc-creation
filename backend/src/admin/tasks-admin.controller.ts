import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { ArrayMaxSize, IsArray, IsIn, IsString } from "class-validator";
import { AdminUser, RequireAllPermissions, RequirePermission, type AdminUser as AdminUserType } from "./admin.decorator";
import { AdminRoleService } from "./admin-role.service";
import { TasksAdminService } from "./tasks-admin.service";
import { PERMISSIONS } from "./permissions";
import { AppError } from "../common/app.exception";
import { sendCsv } from "../common/csv-response";
// 值导入: DTO 依赖 design:paramtypes 做实例化与白名单剥离
import { TaskListQueryDto } from "./dto/task.dto";

/**
 * 任务监控 (admin-prd.md §3.5 B-28~B-33)。
 *
 * 权限四点分离:读 (task.read) / 重试 (task.retry) / 终止 (task.cancel) /
 * 删除 (task.delete)。运营需要读全部任务来回答用户"我的图怎么还没出来",
 * 但重试会真实消耗模型额度、终止会作废排队、删除会清理产出,
 * 三者都超出「查看」范畴。
 *
 * 路由顺序: 字面量路径 (`stats` / `capabilities`) 须在 `:id` 之前,
 * 否则被参数路由抢占。
 */
/** 批量重试 / 终止 / 删除 */
export class TaskBatchDto {
  @IsArray()
  @ArrayMaxSize(100, { message: "单次批量最多 100 条" })
  @IsString({ each: true })
  ids!: string[];

  @IsIn(["retry", "cancel", "delete"], {
    message: "action 只能是 retry、cancel 或 delete",
  })
  action!: "retry" | "cancel" | "delete";
}

@Controller("admin/tasks")
export class AdminTasksController {
  constructor(
    private readonly tasks: TasksAdminService,
    private readonly roles: AdminRoleService,
  ) {}

  /** 拥堵指标 (B-31)。独立端点: 顶部告警条需高频刷新, 不必连带拉整页列表 */
  @Get("stats")
  @RequirePermission(PERMISSIONS.taskRead)
  stats() {
    return this.tasks.congestion();
  }

  /** 能力下拉项。取自 registry 而非硬编码, 新增能力无需改前端 */
  @Get("capabilities")
  @RequirePermission(PERMISSIONS.taskRead)
  capabilities() {
    return this.tasks.capabilityOptions();
  }

  /**
   * 批量重试 / 终止 / 删除（B7）。
   *
   * 权限按 action 判定：重试要 `task.retry`，终止要 `task.cancel`，
   * 删除要 `task.delete`。三者都会真实影响用户可见状态或产出，
   * 所以批量入口不能只凭 `task.read` 就放行。
   */
  @Post("batch")
  @RequirePermission(PERMISSIONS.taskRead)
  async batch(@Body() dto: TaskBatchDto, @AdminUser() actor: AdminUserType) {
    const needed =
      dto.action === "retry"
        ? PERMISSIONS.taskRetry
        : dto.action === "cancel"
          ? PERMISSIONS.taskCancel
          : PERMISSIONS.taskDelete;
    if (!(await this.roles.hasPermission(actor.id, needed))) {
      throw new AppError(40301, `没有执行该批量动作的权限（${needed}）`, 403);
    }
    return this.tasks.batchAction(dto.ids, dto.action);
  }

  /** 任务列表 + 拥堵统计 + 筛选项 (B-28 / B-29) */
  @Get()
  @RequirePermission(PERMISSIONS.taskRead)
  list(@Query() query: TaskListQueryDto) {
    return this.tasks.list(query);
  }

  /**
   * 导出任务 (CSV)。
   *
   * 路由必须声明在 `:id` 之前，否则 `export` 会被当成任务 id。
   * 导出把用户数据带出系统，使用独立的 `data.export` 权限点。
   */
  @Get("export")
  @RequireAllPermissions(PERMISSIONS.taskRead, PERMISSIONS.dataExport)
  async export(@Query() query: TaskListQueryDto, @Res() res: Response) {
    const csv = await this.tasks.exportCsv(query);
    sendCsv(res, "tasks", csv);
  }

  /** 任务详情: 输入素材 / 参数 JSON / 产出图 / 时间线 (B-30) */
  @Get(":id")
  @RequirePermission(PERMISSIONS.taskRead)
  detail(@Param("id") id: string) {
    return this.tasks.detail(id);
  }

  /**
   * 删除已结束任务。
   *
   * 删除会清理任务记录、子任务、产出素材与存储文件, 不可恢复。
   * 排队中/执行中的任务必须先终止, 避免 worker 继续操作已删除的任务。
   */
  @Delete(":id")
  @RequirePermission(PERMISSIONS.taskDelete)
  remove(@Param("id") id: string) {
    return this.tasks.remove(id);
  }

  /**
   * 失败重试 (B-32): 用原参数与输入新建任务。
   *
   * 重试触发真实生成, 会消耗模型额度, 因此必须走独立权限校验。
   */
  @Post(":id/retry")
  @RequirePermission(PERMISSIONS.taskRetry)
  retry(@Param("id") id: string) {
    return this.tasks.retry(id);
  }

  /**
   * 终止运行中任务 (B-33): 作废排队与产出, 用户端立即可见失败。
   *
   * 终止会作废用户已提交的动作, 属高危, 因此必须走独立权限校验。
   */
  @Post(":id/cancel")
  @RequirePermission(PERMISSIONS.taskCancel)
  cancel(@Param("id") id: string) {
    return this.tasks.cancel(id);
  }
}
