import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { AuditAction, RequirePermission } from './admin.decorator';
import { AppError } from '../common/app.exception';
import { AdminRoleService } from './admin-role.service';
import { AdminSettingsService } from './settings.service';
import { PERMISSIONS, ROLE_LABELS, isAdminRole } from './permissions';
// ⚠️ DTO 必须用值导入 (不能用 `import type`)。
// `import type` 会在编译期抹掉类的运行时值, 使 design:paramtypes 退化成 Function,
// ValidationPipe 因此无法识别类型 —— @Body 拿到的是未校验的原始 body,
// 结果是「请求 200 但 DTO 上一个字段都没生效」, 比直接报错更难排查。
import { RoleListQueryDto, UpdateRolePermissionsDto } from './dto/audit.dto';
import { collectSettingEntries, UpdateSettingsDto } from './settings.dto';

/** 角色权限管理 */
@Controller('admin/roles')
export class AdminRolesController {
  constructor(private readonly roles: AdminRoleService) {}

  /**
   * 角色列表与各自的生效权限点。
   *
   * 返回的是**库里的实际值**而非代码默认值 —— 运营改过的权限要如实呈现,
   * 否则角色页会显示与实际不符的权限, 造成误操作。
   */
  @Get()
  @RequirePermission(PERMISSIONS.auditRead)
  async list(@Query() query: RoleListQueryDto) {
    const codes = query.code && isAdminRole(query.code) ? [query.code] : Object.keys(ROLE_LABELS).filter(isAdminRole);
    const items = [];
    for (const code of codes) {
      items.push({
        code,
        label: ROLE_LABELS[code] ?? code,
        builtIn: true,
        permissions: await this.roles.getPermissions(code),
      });
    }
    return { items };
  }

  /**
   * 更新角色权限点。
   *
   * 立即生效: AdminGuard/PermissionGuard 每次请求查库, 无需重启或重新登录。
   * 保护: 操作者自身的权限收窄也会立即生效 —— 这是刻意的,
   * "改完自己就锁在门外"是可接受的 (有其他 admin 可救), 换取的是权限确实收紧。
   */
  @Patch(':code/permissions')
  @RequirePermission(PERMISSIONS.roleWrite)
  @AuditAction('role.permissions_update')
  async updatePermissions(@Param('code') code: string, @Body() dto: UpdateRolePermissionsDto) {
    if (!isAdminRole(code)) {
      throw new AppError(40400, '未知角色', 404);
    }
    await this.roles.updatePermissions(code, dto.permissions ?? []);
    return { code, permissions: await this.roles.getPermissions(code) };
  }
}

/** 系统设置 */
@Controller('admin/settings')
export class AdminSettingsController {
  constructor(private readonly settings: AdminSettingsService) {}

  /** 分组读取全部设置 */
  @Get()
  @RequirePermission(PERMISSIONS.settingRead)
  read() {
    return this.settings.readAll();
  }

  /**
   * 写入系统设置。
   *
   * 扁平结构提交 (siteName / uploadMaxSizeMb / ...), 字段名到 SETTING_DEFS
   * key 的映射见 collectSettingEntries。
   * 未提供任何字段时返回 400, 而不是静默成功。
   */
  @Patch()
  @RequirePermission(PERMISSIONS.settingWrite)
  @AuditAction('setting.update')
  update(@Body() dto: UpdateSettingsDto) {
    const entries = collectSettingEntries(dto);
    return this.settings.updateAll(entries, dto?.reason);
  }
}