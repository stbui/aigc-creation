import { Inject, Injectable } from '@nestjs/common';
import { CACHE_MANAGER, type Cache } from '@nestjs/cache-manager';
import { PrismaService } from '../prisma/prisma.service';
import { AppError } from '../common/app.exception';
import {
  ADMIN_ROLE_CODES,
  expandImpliedPermissions,
  isAdminRole,
  isKnownPermission,
  ROLE_PERMISSIONS,
  type AdminRoleCode,
} from './permissions';

export interface RolePermissionUpdate {
  code: AdminRoleCode;
  permissions: string[];
}

export interface RolePermissionChange {
  code: AdminRoleCode;
  before: string[];
  after: string[];
  added: string[];
  removed: string[];
}

/**
 * 后台角色的读取与判定。
 *
 * 身份 (role / status) 每次请求实时读库而非信任 JWT 载荷: JWT TTL 默认 7 天
 * (common/jwt.service.ts), 只信 token 里的 role 会让「降权 / 禁用」在最多
 * 7 天内不生效。
 *
 * 角色权限点单独做 30 秒缓存: 每个后台请求都会经过 PermissionGuard,
 * 而角色权限几乎只在「角色页保存」时变化。缓存以短 TTL 兜底, 并在
 * `updatePermissions` 成功后精确失效, 不必为一次权限校验多打一次库。
 */
@Injectable()
export class AdminRoleService {
  private static readonly PERMISSION_CACHE_TTL_MS = 30_000;
  private static permissionCacheKey(role: string): string {
    return `admin:permissions:${role}`;
  }

  constructor(
    private readonly prisma: PrismaService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) {}

  /**
   * 判定用户是否有指定权限点。
   *
   * 兜底默认拒: role 非后台角色、无对应权限点、账号非 active, 一律false。
   */
  async hasPermission(userId: string, permission: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, status: true },
    });
    if (!user) return false;
    if (user.status !== 'active') return false;
    if (!isAdminRole(user.role)) return false;

    const permissions = await this.getPermissions(user.role);
    return permissions.includes(permission);
  }

  /**
   * 解析角色权限点。
   *
   * 未登记的权限点 (从PERMISSIONS 移除后残留在库里的旧值) 会被过滤,
   * 避免角色页出现无法解释的无效项。过滤结果只在内存生效, 不回写库 —
   * 回写属于管理动作, 应由角色页显式保存时完成。
   */
  async getPermissions(role: string): Promise<string[]> {
    const key = AdminRoleService.permissionCacheKey(role);
    const cached = await this.cache.get<string[]>(key);
    if (cached !== undefined) return cached;

    const record = await this.prisma.adminRole.findUnique({ where: { code: role } });
    const permissions = record ? this.parsePermissions(record.permissions) : [];
    await this.cache.set(key, permissions, AdminRoleService.PERMISSION_CACHE_TTL_MS);
    return permissions;
  }

  /** 角色权限变更后立即失效; 不传 role 时清空全部内置角色 (供脚本 / 测试使用) */
  async invalidatePermissions(role?: string): Promise<void> {
    const roles = role ? [role] : [...ADMIN_ROLE_CODES];
    await Promise.all(
      roles.map((code) => this.cache.del(AdminRoleService.permissionCacheKey(code))),
    );
  }

  /**
   * 更新角色权限点。
   *
   * 内置角色可改权限但不可删除/改名; 未知权限点直接拒绝, 不静默丢弃,
   * 否则调用方会以为设置成功而实际未生效。
   */
  async updatePermissions(updates: RolePermissionUpdate[]): Promise<RolePermissionChange[]> {
    const seenRoles = new Set<string>();
    for (const update of updates) {
      if (seenRoles.has(update.code)) {
        throw new AppError(40001, `角色重复: ${update.code}`, 400);
      }
      seenRoles.add(update.code);

      if (new Set(update.permissions).size !== update.permissions.length) {
        throw new AppError(40001, `权限点重复: ${update.code}`, 400);
      }

      const unknown = update.permissions.filter((p) => !isKnownPermission(p));
      if (unknown.length > 0) {
        throw new AppError(40001, `未知权限点: ${unknown.join(', ')}`, 400);
      }
    }

    /*
     * 多角色保存必须原子提交。前端一次点击可能同时改动 admin / operator，
     * 若逐条 update，第二条失败会留下「页面显示保存失败，但部分权限已收紧」。
     * 读取也放进事务，确保返回的 before/after 对应同一次写入。
     */
    const changes = await this.prisma.$transaction(async (tx) => {
      const records = await tx.adminRole.findMany({
        where: { code: { in: updates.map((update) => update.code) } },
      });
      const byCode = new Map(records.map((record) => [record.code, record]));
      const missing = updates
        .map((update) => update.code)
        .filter((code) => !byCode.has(code));
      if (missing.length > 0) {
        throw new AppError(40400, `角色不存在: ${missing.join(', ')}`, 404);
      }

      const changes: RolePermissionChange[] = [];
      for (const update of updates) {
        const record = byCode.get(update.code)!;
        const before = this.parsePermissions(record.permissions);
        // 保存时展开隐含权限：只授了 marketing.write 的角色也会落上 marketing.read，
        // 下次读取不必再依赖隐含规则。
        const after = expandImpliedPermissions([...update.permissions]);
        const beforeSet = new Set(before);
        const afterSet = new Set(after);
        const change: RolePermissionChange = {
          code: update.code,
          before,
          after,
          added: after.filter((permission) => !beforeSet.has(permission)),
          removed: before.filter((permission) => !afterSet.has(permission)),
        };

        await tx.adminRole.update({
          where: { code: update.code },
          data: { permissions: JSON.stringify(after) },
        });
        changes.push(change);
      }
      return changes;
    });

    // 写入口只有这一处; 保存成功后精确失效, 不必等 TTL
    await Promise.all(changes.map((change) => this.invalidatePermissions(change.code)));
    return changes;
  }

  /** 库里是 JSON 字符串；损坏或旧权限点一律按无权处理。 */
  private parsePermissions(raw: string): string[] {
    let list: unknown;
    try {
      list = JSON.parse(raw);
    } catch {
      return [];
    }
    if (!Array.isArray(list)) return [];
    const known = list.filter(
      (p): p is string => typeof p === 'string' && isKnownPermission(p),
    );
    return expandImpliedPermissions(known);
  }

  /** 内置角色的默认权限 (供 seed 使用) */
  static defaultPermissions(role: AdminRoleCode): string[] {
    return ROLE_PERMISSIONS[role];
  }
}
