import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";
import { ADMIN_ROLE_CODES, type AdminRoleCode } from "../permissions";

/** 单个角色的权限全集 */
export class RolePermissionUpdateDto {
  @IsIn(ADMIN_ROLE_CODES, { message: "角色 code 非法" })
  code!: AdminRoleCode;

  /** 权限点全集。未知权限点由 service 层直接拒绝, 不静默丢弃 */
  @IsArray()
  @ArrayUnique({ message: "权限点不能重复" })
  @IsString({ each: true })
  permissions!: string[];
}

/**
 * 批量更新角色权限。
 *
 * 一次页面保存可能同时改动多个角色，必须在一个事务里提交；逐角色发请求会
 * 产生「前一个角色已生效、后一个失败」的半保存状态。
 */
export class UpdateRolePermissionsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(ADMIN_ROLE_CODES.length)
  @ValidateNested({ each: true })
  @Type(() => RolePermissionUpdateDto)
  roles!: RolePermissionUpdateDto[];
}

/** 角色查询 */
export class RoleListQueryDto {
  @IsOptional()
  @IsIn(["admin", "operator", "finance"])
  code?: string;
}
