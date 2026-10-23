import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { AdminUser, AuditAction, RequirePermission, type AdminUser as AdminUserType } from './admin.decorator';
import { AdminRoleService } from './admin-role.service';
import { TasksAdminService } from './tasks-admin.service';
import { PERMISSIONS } from './permissions';
import { AppError } from '../common/app.exception';
// 值导入: DTO 依赖 design:paramtypes 做实例化与白名单剥离
import { TaskListQueryDto } from './dto/task.dto';

/**
 * 重试/终止的操作原因。
 *
 * 两者共用: 二者都是会改变用户可见任务状态的高危动作, 都需要事后能回答
 * "谁、为什么"。字段本身由 AuditInterceptor 从 body 读取并落库。
 */
export class TaskActionDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;
}

/**
 * 任务监控 (admin-prd.md §3.5 B-28~B-33)。
 *
 * 权限三点分离:读 (task.read) / 重试 (task.retry) / 终止 (task.cancel)。
 * 运营需要读全部任务来回答用户"我的图怎么还没出来", 但重试会真实消耗
 * 模型额度、终止会作废用户的排队 —— 两者都超出「查看」范畴。
 *
 * 路由顺序: 字面量路径 (`stats` / `capabilities`) 须在 `:id` 之前,
 * 否则被参数路由抢占。
 */
/** 批量重试 / 终止 */
export class TaskBatchDto {
  @IsArray()
  @ArrayMaxSize(100, { message: '单次批量最多 100 条' })
  @IsString({ each: true })
  ids!: string[];

  @IsIn(['retry', 'cancel'], { message: 'action 只能是 retry 或 cancel' })
  action!: 'retry' | 'cancel';

  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;
}

@Controller('admin/tasks')
export class AdminTasksController {
  constructor(
    private readonly tasks: TasksAdminService,
    private readonly roles: AdminRoleService,
  ) {}

  /** 拥堵指标 (B-31)。独立端点: 顶部告警条需高频刷新, 不必连带拉整页列表 */
  @Get('stats')
  @RequirePermission(PERMISSIONS.taskRead)
  stats() {
    return this.tasks.congestion();
  }

  /** 能力下拉项。取自 registry 而非硬编码, 新增能力无需改前端 */
  @Get('capabilities')
  @RequirePermission(PERMISSIONS.taskRead)
  capabilities() {
    return this.tasks.capabilityOptions();
  }

  /**
   * 批量重试 / 终止（B7）。
   *
   * 权限按 action 判定：重试要 `task.retry`，终止要 `task.cancel`。
   * 两者都会真实影响用户可见状态（重试消耗模型额度、终止作废排队），
   * 所以批量入口不能只凭 `task.read` 就放行。
   */
  @Post('batch')
  @RequirePermission(PERMISSIONS.taskRead)
  @AuditAction('task.batch')
  async batch(@Body() dto: TaskBatchDto, @AdminUser() actor: AdminUserType) {
    const needed = dto.action === 'retry' ? PERMISSIONS.taskRetry : PERMISSIONS.taskCancel;
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

  /** 任务详情: 输入素材 / 参数 JSON / 产出图 / 时间线 (B-30) */
  @Get(':id')
  @RequirePermission(PERMISSIONS.taskRead)
  detail(@Param('id') id: string) {
    return this.tasks.detail(id);
  }

  /**
   * 失败重试 (B-32): 用原参数与输入新建任务。
   *
   * 挂审计 —— 重试触发真实生成, 会消耗模型额度, 事后必须可追溯。
   *
   * ⚠ dto 在此**刻意不传给 service**: 审计拦截器自己从 `request.body.reason`
   * 取操作原因, 服务层不需要它。这里声明 @Body() 的唯一作用是让全局
   * ValidationPipe 按 TaskActionDto 校验并剥离字段 —— 不声明的话 reason
   * 会因 whitelist 直接被丢弃, 前端填的重试原因就永远进不了审计表。
   */
  @Post(':id/retry')
  @RequirePermission(PERMISSIONS.taskRetry)
  @AuditAction('task.retry')
  retry(@Param('id') id: string, @Body() _dto: TaskActionDto) {
    return this.tasks.retry(id);
  }

  /**
   * 终止运行中任务 (B-33): 作废排队与产出, 用户端立即可见失败。
   *
   * 终止是作废用户已提交的动作, 属高危 —— 同样声明 DTO 让 reason
   * 能落进审计表 (理由同上, reason 由拦截器自行读取)。
   */
  @Post(':id/cancel')
  @RequirePermission(PERMISSIONS.taskCancel)
  @AuditAction('task.cancel')
  cancel(@Param('id') id: string, @Body() _dto: TaskActionDto) {
    return this.tasks.cancel(id);
  }
}
