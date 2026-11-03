import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AppError } from '../common/app.exception';
import {
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
 * 每次判定都实时读库而非信任 JWT 载荷: JWT TTL 默认 7 天 (common/jwt.service.ts),
 * 只信 token 里的 role 会让「降权 / 禁用」在最多 7 天内不生效。
 * SQLite 本地单文件、后台接口低频, 查库开销可忽略, 换来的是权限即时正确。
 */
@Injectable()
export class AdminRoleService {
  constructor(private readonly prisma: PrismaService) {}

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
    const record = await this.prisma.adminRole.findUnique({ where: { code: role } });
    if (!record) return [];
    return this.parsePermissions(record.permissions);
  }

  /** 后台身份校验: 无后台角色或账号非 active 时抛错 */
  assertAdminAccess(userId: string): Promise<void> {
    return (async () => {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { role: true, status: true },
      });
      if (!user) throw new AppError(40101, '未认证', 401);
      if (user.status === 'disabled') throw new AppError(40302, '账号已被禁用', 403);
      if (user.status === 'deleted') throw new AppError(40302, '账号已注销', 403);
      if (!isAdminRole(user.role)) throw new AppError(40301, '需要管理员权限', 403);
    })();
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
     * 读取也放进事务，确保审计里的 before/after 对应同一次写入。
     */
    return this.prisma.$transaction(async (tx) => {
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
        const after = [...update.permissions];
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
    return list.filter((p): p is string => typeof p === 'string' && isKnownPermission(p));
  }

  /** 内置角色的默认权限 (供 seed 使用) */
  static defaultPermissions(role: AdminRoleCode): string[] {
    return ROLE_PERMISSIONS[role];
  }
}
