import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AppError } from '../common/app.exception';
import {
  isAdminRole,
  isKnownPermission,
  ROLE_PERMISSIONS,
  type AdminRoleCode,
} from './permissions';

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
    let list: unknown;
    try {
      list = JSON.parse(record.permissions);
    } catch {
      // 库里的permissions 不是合法 JSON: 视为无权限 (兜底默认拒), 不抛错阻断请求
      return [];
    }
    if (!Array.isArray(list)) return [];
    return list.filter((p): p is string => typeof p === 'string' && isKnownPermission(p));
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
  async updatePermissions(role: AdminRoleCode, permissions: string[]) {
    const unknown = permissions.filter((p) => !isKnownPermission(p));
    if (unknown.length > 0) {
      throw new AppError(40001, `未知权限点: ${unknown.join(', ')}`, 400);
    }
    const record = await this.prisma.adminRole.findUnique({ where: { code: role } });
    if (!record) throw new AppError(40400, '角色不存在', 404);

    return this.prisma.adminRole.update({
      where: { code: role },
      data: { permissions: JSON.stringify(permissions) },
    });
  }

  /** 内置角色的默认权限 (供 seed 使用) */
  static defaultPermissions(role: AdminRoleCode): string[] {
    return ROLE_PERMISSIONS[role];
  }
}