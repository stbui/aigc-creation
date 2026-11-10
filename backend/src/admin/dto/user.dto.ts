import { IsIn, IsOptional, IsString, MaxLength } from "class-validator";
import { USER_ROLES, type UserRole } from "../permissions";
import { PageQueryDto } from "./page-query.dto";

/** 用户列表查询 */
export class UserListQueryDto extends PageQueryDto {
  /** 邮箱前缀或包含匹配。模糊查询不走索引, 但用户表量级可控 */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  keyword?: string;

  @IsOptional()
  @IsIn(USER_ROLES, { message: "role 取值非法" })
  role?: string;

  @IsOptional()
  @IsIn(["active", "disabled", "deleted"], { message: "status 取值非法" })
  status?: string;

  /** 注册时间下界 (ISO 字符串) */
  @IsOptional()
  @IsString()
  from?: string;

  /** 注册时间上界 (ISO 字符串) */
  @IsOptional()
  @IsString()
  to?: string;

  /** 运营分群：从未登录 / 30 天未登录 / 无可见任务 */
  @IsOptional()
  @IsIn(["never_login", "inactive_30d", "no_tasks"], {
    message: "segment 取值非法",
  })
  segment?: "never_login" | "inactive_30d" | "no_tasks";

  /** 会员状态：有生效中的会员记录 / 没有 */
  @IsOptional()
  @IsIn(["member", "non_member"], { message: "membership 取值非法" })
  membership?: "member" | "non_member";
}

/** 禁用/启用 */
export class ChangeUserStatusDto {
  @IsIn(["active", "disabled"], { message: "只能设为正常或禁用" })
  status!: "active" | "disabled";

}

/** 角色变更 */
export class ChangeUserRoleDto {
  @IsIn(USER_ROLES, { message: "role 取值非法" })
  role!: UserRole;

}

/** 物理删除 */
export class DeleteUserDto {
  /** 物理删除确认词。仅 hard=true 时校验, 软注销无需确认词 */
  @IsOptional()
  @IsString()
  confirm?: string;
}
