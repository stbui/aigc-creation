/**
 * 后台前台模型接口（`/api/v1/admin/logical-models`）。
 *
 * 移植自 open-ai-canvas `handler/logical_models.go` 的管理端部分：
 *   · `GET    /admin/logical-models`           列表（含归档开关）
 *   · `POST   /admin/logical-models`           新建
 *   · `PATCH  /admin/logical-models/:id`       保存（新 revision + 线路重建）
 *   · `DELETE /admin/logical-models/:id`       归档
 *   · `POST   /admin/logical-models/:id/simulate` 路由模拟（只读）
 *
 * 语义校验在 `LogicalModelAdminService`；这里只做形状校验与权限 / 审计声明。
 * `PATCH` 按**全量提交**处理（与参考实现一致）—— 前端表单始终提交完整对象，
 * 缺省字段会按默认值落库，不要用它做「只改一个字段」的局部更新。
 */

import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { Allow, IsArray, IsBoolean, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { AdminUser, AuditAction, RequirePermission } from '../../admin/admin.decorator';
import type { AdminUser as AdminUserContext } from '../../admin/admin.decorator';
import { PERMISSIONS } from '../../admin/permissions';
import { buildModelRequestIntent } from '../intent/model-intent';
import { RouterService } from '../routing/router.service';
import { UserGroupService } from '../user-groups/user-group.service';
import { ModelIntentBodyDto } from './models.controller';
import { LogicalModelAdminService, type LogicalModelRequest } from './logical-model.admin.service';

export class SimulateBodyDto extends ModelIntentBodyDto {
  /** 高危动作原因（可选；模拟本身只读，不强制） */
  @IsOptional() @IsString() reason?: string;
}

/** 线路入参：嵌套对象整体透传，语义校验在 service */
export class LogicalRouteBodyDto {
  @IsOptional() @IsString() channelModelId?: string;
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsInt() @Min(0) @Max(999_999) priority?: number;
  @IsOptional() @IsInt() @Min(0) @Max(100_000) weight?: number;
}

/** 前台模型保存入参 */
export class LogicalModelWriteBodyDto {
  @IsOptional() @IsString() code?: string;
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() icon?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() capability?: string;
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsInt() @Min(0) @Max(999_999) sortOrder?: number;
  @IsOptional() @IsString() pricePolicy?: string;
  @IsOptional() @IsString() billingMode?: string;
  @IsOptional() @Allow() unitPriceMicrocredits?: number | string;
  @IsOptional() @Allow() inputPriceMicrocredits?: number | string;
  @IsOptional() @Allow() outputPriceMicrocredits?: number | string;
  @IsOptional() @Allow() cachedPriceMicrocredits?: number | string;
  @IsOptional() @IsArray() @IsString({ each: true }) legacyModelIds?: string[] | null;
  @IsOptional() @Allow() capabilitySpec?: unknown;
  @IsOptional() @Allow() defaultOptions?: Record<string, unknown> | null;
  @IsOptional() @IsArray() @Allow() routes?: LogicalRouteBodyDto[];
  @IsOptional() @IsString() sourceChannelModelId?: string;
  /** 高危动作原因（写审计） */
  @IsOptional() @IsString() reason?: string;
}

@Controller('admin/logical-models')
export class AdminLogicalModelsController {
  constructor(
    private readonly models: LogicalModelAdminService,
    private readonly router: RouterService,
    private readonly groups: UserGroupService,
  ) {}

  @Get()
  @RequirePermission(PERMISSIONS.logicalModelRead)
  list(@Query('includeArchived') includeArchived?: string) {
    return this.models.list(String(includeArchived ?? '') === '1' || String(includeArchived ?? '') === 'true');
  }

  @Get(':id')
  @RequirePermission(PERMISSIONS.logicalModelRead)
  get(@Param('id') id: string) {
    return this.models.get(id);
  }

  @Post()
  @RequirePermission(PERMISSIONS.logicalModelWrite)
  @AuditAction('logical_model.create')
  create(@Body() body: LogicalModelWriteBodyDto, @AdminUser() user: AdminUserContext) {
    return this.models.save('', body as LogicalModelRequest, user?.id ?? '');
  }

  /** 静态段 `:id/simulate` 与 `:id` 分属不同 HTTP 方法，不冲突 */
  @Post(':id/simulate')
  @RequirePermission(PERMISSIONS.logicalModelRead)
  async simulate(@Param('id') id: string, @Body() body: SimulateBodyDto) {
    const access = await this.groups.systemAccess();
    const intent = buildModelRequestIntent({
      capability: body?.capability,
      operation: body?.operation,
      inputs: body?.inputs,
      options: body?.options,
    });
    return this.router.simulate(access, id, intent);
  }

  @Patch(':id')
  @RequirePermission(PERMISSIONS.logicalModelWrite)
  @AuditAction('logical_model.update')
  update(@Param('id') id: string, @Body() body: LogicalModelWriteBodyDto, @AdminUser() user: AdminUserContext) {
    return this.models.save(id, body as LogicalModelRequest, user?.id ?? '');
  }

  @Delete(':id')
  @RequirePermission(PERMISSIONS.logicalModelWrite)
  @AuditAction('logical_model.archive')
  async archive(@Param('id') id: string) {
    await this.models.archive(id);
    return { ok: true };
  }
}
