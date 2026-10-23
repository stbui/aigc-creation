import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { AdminUser, AuditAction, RequirePermission, type AdminUser as AdminUserType } from './admin.decorator';
import { PERMISSIONS } from './permissions';
import { LEGAL_SLUGS, LEGAL_STATUSES, LegalService } from '../legal/legal.service';

class UpsertLegalDto {
  @IsIn(LEGAL_SLUGS as unknown as string[], { message: '未知的法务文档类型' })
  slug: string;

  @IsString()
  @IsNotEmpty({ message: '请填写版本号' })
  @MaxLength(40)
  version: string;

  @IsString()
  @IsNotEmpty({ message: '请填写标题' })
  @MaxLength(80)
  title: string;

  @IsString()
  @IsNotEmpty({ message: '正文不能为空' })
  content: string;

  @IsOptional()
  @IsIn(LEGAL_STATUSES as unknown as string[])
  status?: 'draft' | 'published' | 'archived';

  /** 仅用于审计 detail，服务层不消费 —— DTO 必须收下它，否则 whitelist 会剥掉 */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;
}

class PublishLegalDto {
  /** 同上：高危动作的操作原因，落审计 */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;
}

/**
 * 后台法务文档管理。
 *
 * 正文是**用户要举证的文本**，因此改动一律走审计，且已发布版本不可原地覆盖
 * （`LegalService.upsert` 会拒绝）。前端只能「新建版本 → 发布」，
 * 不能「改一下再点发布」—— 后者会让昨天同意过的人拿到一份不同的协议。
 */
@Controller('admin/legal')
export class AdminLegalController {
  constructor(private readonly legal: LegalService) {}

  @Get()
  // 读与写分开: legal.read 授予了运营/财务, 此前所有端点都要求 legal.write,
  // 这个权限点因此悬空 —— 有读权限的角色既进不了菜单也调不通只读接口。
  @RequirePermission(PERMISSIONS.legalRead)
  versions(@Query('slug') slug?: string) {
    return this.legal.versions(slug);
  }

  @Put()
  @RequirePermission(PERMISSIONS.legalWrite)
  @AuditAction('legal.upsert')
  upsert(@Body() dto: UpsertLegalDto, @AdminUser() admin: AdminUserType) {
    return this.legal.upsert(dto, admin.id);
  }

  @Post(':slug/:version/publish')
  @RequirePermission(PERMISSIONS.legalWrite)
  @AuditAction('legal.publish')
  publish(
    @Param('slug') slug: string,
    @Param('version') version: string,
    @Body() _dto: PublishLegalDto,
  ) {
    // reason 由 AuditInterceptor 从请求体读取；这里显式收下 DTO 才能通过
    // `whitelist: true` 的过滤（未声明的字段会被静默丢弃）
    return this.legal.publish(slug, version);
  }
}
