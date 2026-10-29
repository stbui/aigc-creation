import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { AdminUser, AuditAction, RequirePermission, type AdminUser as AdminUserType } from './admin.decorator';
import { AdminRoleService } from './admin-role.service';
import { AdminAssetsService } from './assets-admin.service';
import { PERMISSIONS } from './permissions';
import { AppError } from '../common/app.exception';
import { sendCsv } from '../common/csv-response';
// 必须用运行时导入: `import type` 会让 Nest 的 design:paramtypes 退化成
// Object/Function, ValidationPipe 无法转换 pageSize, 分页会静默退回默认 20。
import { AssetListQueryDto, ProjectListQueryDto } from './dto/asset.dto';

/** 下架/恢复 */
export class AssetStatusDto {
  @IsIn(['visible', 'hidden'], { message: 'status 取值非法' })
  status!: 'visible' | 'hidden';
}

/** 批量下架 */
export class AssetBatchStatusDto {
  @IsString({ each: true })
  ids!: string[];
  @IsIn(['visible', 'hidden'])
  status!: 'visible' | 'hidden';
}

/** 批量动作 */
export class AssetBatchDto {
  @IsArray()
  @ArrayMaxSize(100, { message: '单次批量最多 100 条' })
  @IsString({ each: true })
  ids!: string[];

  @IsIn(['hide', 'show', 'delete'], { message: 'action 只能是 hide / show / delete' })
  action!: 'hide' | 'show' | 'delete';

  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;
}

/**
 * 项目与素材管理 (admin-prd.md §3.4 B-21~B-27)。
 *
 * 路由顺序: 字面量路径须在 `:id` 之前, 否则被参数路由抢占。
 */
@Controller('admin')
export class AdminAssetsController {
  constructor(
    private readonly assets: AdminAssetsService,
    private readonly roles: AdminRoleService,
  ) {}

  // ── 项目 ──────────────────────────────────────────────────────────

  @Get('projects')
  @RequirePermission(PERMISSIONS.projectRead)
  listProjects(@Query() query: ProjectListQueryDto) {
    return this.assets.listProjects(query);
  }

  /**
   * 删除项目 (B-22)。
   * `?hard=true` 连带删除素材记录与文件; 默认软删(素材置hidden)。
   */
  @Delete('projects/:id')
  @RequirePermission(PERMISSIONS.projectDelete)
  @AuditAction('project.delete')
  removeProject(@Param('id') id: string, @Query('hard') hard?: string) {
    return this.assets.removeProject(id, hard === 'true');
  }

  // ── 素材 ──────────────────────────────────────────────────────────

  @Get('assets/stats')
  @RequirePermission(PERMISSIONS.assetRead)
  stats() {
    return this.assets.stats();
  }

  @Get('assets')
  @RequirePermission(PERMISSIONS.assetRead)
  list(@Query() query: AssetListQueryDto) {
    return this.assets.list(query);
  }

  /** 删除前的连带影响预览 */
  @Get('assets/:id/impact')
  @RequirePermission(PERMISSIONS.assetRead)
  impact(@Param('id') id: string) {
    return this.assets.impact(id);
  }

  /**
   * 下架/ 恢复 (B-26)。
   * 只改 status, 文件与记录都保留 —— 误下架可恢复。
   */
  @Patch('assets/:id/status')
  @RequirePermission(PERMISSIONS.assetHide)
  @AuditAction('asset.status_change')
  setStatus(@Param('id') id: string, @Body() dto: AssetStatusDto) {
    return this.assets.setStatus(id, dto.status);
  }

  /** 批量下架 (B-87): 每条仍写审计 —— 批量不等于免审计 */
  @Post('assets/batch-status')
  @RequirePermission(PERMISSIONS.assetHide)
  @AuditAction('asset.batch_status')
  batchStatus(@Body() dto: AssetBatchStatusDto) {
    return this.assets.setStatusMany(dto.ids ?? [], dto.status);
  }

  /**
   * 批量动作（B7）：下架 / 恢复 / 删除，逐条返回结果。
   *
   * 权限按 action 单独判定：`asset.hide` 管下架/恢复，`asset.delete` 管删除。
   * 删除是资产级不可逆动作，不能因为"路由上挂了 hide 权限"就被顺带放开。
   */
  @Post('assets/batch')
  @RequirePermission(PERMISSIONS.assetRead)
  @AuditAction('asset.batch')
  async batch(@Body() dto: AssetBatchDto, @AdminUser() actor: AdminUserType) {
    const needed = dto.action === 'delete' ? PERMISSIONS.assetDelete : PERMISSIONS.assetHide;
    if (!(await this.roles.hasPermission(actor.id, needed))) {
      throw new AppError(40301, `没有执行该批量动作的权限（${needed}）`, 403);
    }
    return this.assets.batchAction(dto.ids, dto.action);
  }

  /** 素材导出 (CSV) */
  @Get('assets/export')
  @RequirePermission(PERMISSIONS.dataExport)
  @AuditAction('data.export')
  async export(@Query() query: AssetListQueryDto, @Res() res: Response) {
    const csv = await this.assets.exportCsv(query);
    sendCsv(res, 'assets', csv);
  }

  /** 删除素材 (B-27): 连带磁盘文件与产出任务, 不可逆 */
  @Delete('assets/:id')
  @RequirePermission(PERMISSIONS.assetDelete)
  @AuditAction('asset.delete')
  remove(@Param('id') id: string) {
    return this.assets.remove(id);
  }
}
