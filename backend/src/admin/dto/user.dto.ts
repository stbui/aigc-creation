import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { ADMIN_ROLE_CODES, type AdminRoleCode } from '../permissions';
import { PageQueryDto } from './page-query.dto';

/** 用户列表查询 */
export class UserListQueryDto extends PageQueryDto {
  /** 邮箱前缀或包含匹配。模糊查询不走索引, 但用户表量级可控 */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  keyword?: string;

  @IsOptional()
  @IsIn(['user', ...ADMIN_ROLE_CODES], { message: 'role 取值非法' })
  role?: string;

  @IsOptional()
  @IsIn(['active', 'disabled', 'deleted'], { message: 'status 取值非法' })
  status?: string;

  /** 注册时间下界 (ISO 字符串) */
  @IsOptional()
  @IsString()
  from?: string;

  /** 注册时间上界 (ISO 字符串) */
  @IsOptional()
  @IsString()
  to?: string;
}

/** 禁用/启用: status 之外还允许填原因 */
export class ChangeUserStatusDto {
  @IsIn(['active', 'disabled'], { message: '只能设为正常或禁用' })
  status!: 'active' | 'disabled';

  /** 操作原因。选填但强烈建议 —— 禁用是重要操作, 有原因便于复核 */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;
}

/** 角色变更 */
export class ChangeUserRoleDto {
  @IsIn(ADMIN_ROLE_CODES, { message: '只能授予后台角色' })
  role!: AdminRoleCode;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;
}

/** 物理删除 */
export class DeleteUserDto {
  /** 二次确认词。后端校验, 防止误调用或 CSRF 下的意外删除 */
  @IsString()
  confirm?: string;
}