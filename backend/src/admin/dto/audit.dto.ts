import { IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { PageQueryDto } from './page-query.dto';

/** 审计日志查询 */
export class AuditListQueryDto extends PageQueryDto {
  /** 操作人 id (不是邮箱 —— 邮箱会因匿名化而变化) */
  @IsOptional()
  @IsString()
  actorId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  action?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  targetId?: string;

  @IsOptional()
  @Transform(({ value }) => {
    if (value === undefined) return undefined;
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  })
  @IsBoolean()
  success?: boolean;

  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;
}

/** 角色权限更新 */
export class UpdateRolePermissionsDto {
  /** 权限点全集。未知权限点直接拒绝, 不静默丢弃 */
  @IsString({ each: true })
  permissions!: string[];

  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;
}

/** 角色查询 */
export class RoleListQueryDto {
  @IsOptional()
  @IsIn(['admin', 'operator', 'finance'])
  code?: string;
}