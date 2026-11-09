import {
  Body,
  Controller,
  Get,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { memoryStorage } from "multer";
import type { Request } from "express";
import { maxUploadBytes } from "../assets/image-validation";
import { AuditAction, RequirePermission, AdminUser } from "./admin.decorator";
import { AdminRoleService } from "./admin-role.service";
import { AdminSettingsService } from "./settings.service";
import { PERMISSIONS, ROLE_LABELS, isAdminRole } from "./permissions";
// ⚠️ DTO 必须用值导入 (不能用 `import type`)。
// `import type` 会在编译期抹掉类的运行时值, 使 design:paramtypes 退化成 Function,
// ValidationPipe 因此无法识别类型 —— @Body 拿到的是未校验的原始 body,
// 结果是「请求 200 但 DTO 上一个字段都没生效」, 比直接报错更难排查。
import { RoleListQueryDto, UpdateRolePermissionsDto } from "./dto/audit.dto";
import { UpdateSettingsDto } from "./settings.dto";

/** 角色权限管理 */
@Controller("admin/roles")
export class AdminRolesController {
  constructor(private readonly roles: AdminRoleService) {}

  /**
   * 角色列表与各自的生效权限点。
   *
   * 返回的是**库里的实际值**而非代码默认值 —— 运营改过的权限要如实呈现,
   * 否则角色页会显示与实际不符的权限, 造成误操作。
   */
  @Get()
  @RequirePermission(PERMISSIONS.roleRead)
  async list(@Query() query: RoleListQueryDto) {
    const codes =
      query.code && isAdminRole(query.code)
        ? [query.code]
        : Object.keys(ROLE_LABELS).filter(isAdminRole);
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
  @Patch()
  @RequirePermission(PERMISSIONS.roleWrite)
  @AuditAction("role.permissions_update")
  async updatePermissions(
    @Body() dto: UpdateRolePermissionsDto,
    @Req() req: Request & { auditExtra?: Record<string, unknown> },
  ) {
    const changes = await this.roles.updatePermissions(
      dto.roles.map((role) => ({
        code: role.code,
        permissions: role.permissions,
      })),
    );

    req.auditExtra = {
      roleCodes: changes.map((change) => change.code),
      changes: changes.map((change) => ({
        code: change.code,
        added: change.added,
        removed: change.removed,
        beforeCount: change.before.length,
        afterCount: change.after.length,
      })),
    };

    return {
      roles: changes.map((change) => ({
        code: change.code,
        permissions: change.after,
      })),
    };
  }
}

/** 系统设置 */
@Controller("admin/settings")
export class AdminSettingsController {
  constructor(private readonly settings: AdminSettingsService) {}

  /** 分组读取全部设置 */
  @Get()
  @RequirePermission(PERMISSIONS.settingRead)
  read() {
    return this.settings.readAll();
  }

  /** 上传帮助图片；返回稳定引用与签名预览地址，不直接修改设置值。 */
  @Post("upload")
  @RequirePermission(PERMISSIONS.settingWrite)
  @AuditAction("setting.image_upload")
  @UseInterceptors(
    FileInterceptor("file", {
      storage: memoryStorage(),
      limits: { fileSize: maxUploadBytes(), files: 1 },
    }),
  )
  async upload(
    @UploadedFile() file: { buffer?: Buffer; originalname?: string } | undefined,
    @Req() req: Request,
  ) {
    const result = await this.settings.uploadImage(file);
    (req as Request & { auditExtra?: Record<string, unknown> }).auditExtra = {
      fileName: file?.originalname ?? null,
      settingKey: "payment.helpImage",
      storageValue: result.value,
    };
    return result;
  }

  /**
   * 写入系统设置 / 恢复默认。
   *
   * kv 结构提交：`{ settings: { 'upload.maxSizeMb': 20 }, clears: ['refund.windowDays'] }`。
   * 键的合法性与取值范围由 `SETTING_DEFS` 校验，未知键直接 400。
   */
  @Patch()
  @RequirePermission(PERMISSIONS.settingWrite)
  @AuditAction("setting.update")
  async update(
    @Body() dto: UpdateSettingsDto,
    @AdminUser() user: AdminUser,
    @Req() req: Request,
  ) {
    const result = await this.settings.updateAll(
      dto?.settings ?? {},
      dto?.clears ?? [],
      user?.email ?? "admin",
    );

    /*
     * 把「键 → 旧值 → 新值」交给审计拦截器。
     *
     * 拦截器只从 body 里挑白名单字段，它拿不到旧值（旧值在库里，
     * 请求体里没有）。所以由 service 组装好挂在 request 上 ——
     * 否则审计里只有动作本身，改了哪个键、从几改成几全都查不到。
     */
    (req as Request & { auditExtra?: Record<string, unknown> }).auditExtra = {
      changes: result.changes.map((c) => ({
        key: c.key,
        label: c.label,
        before: c.before,
        after: c.after,
        action: c.action,
      })),
      updated: result.updated,
      cleared: result.cleared,
    };

    return result;
  }
}
