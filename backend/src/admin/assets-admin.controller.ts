import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { AuditAction, RequirePermission } from './admin.decorator';
import { AdminAssetsService } from './assets-admin.service';
import { PERMISSIONS } from './permissions';
import { IsIn, IsString } from 'class-validator';
import type { AssetListQueryDto, ProjectListQueryDto } from './dto/asset.dto';

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

/**
 * 项目与素材管理 (admin-prd.md §3.4 B-21~B-27)。
 *
 * 路由顺序: 字面量路径须在 `:id` 之前, 否则被参数路由抢占。
 */
@Controller('admin')
export class AdminAssetsController {
  constructor(private readonly assets: AdminAssetsService) {}

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

  /** 删除素材 (B-27): 连带磁盘文件与产出任务, 不可逆 */
  @Delete('assets/:id')
  @RequirePermission(PERMISSIONS.assetDelete)
  @AuditAction('asset.delete')
  remove(@Param('id') id: string) {
    return this.assets.remove(id);
  }
}
