import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { AppError } from '../common/app.exception';
import { JwtPayload, JwtService } from '../common/jwt.service';
import { PrismaService } from '../prisma/prisma.service';
import { AdminRoleService } from './admin-role.service';
import { isAdminRole } from './permissions';

/**
 * 后台第一道守卫: 身份与账号状态。
 *
 * 职责:
 *   1. 仅对 /admin/* 生效 (本守卫全局注册, 非后台路径直接放行)
 *   2. 校验 Bearer token (与 C 端 JwtAuthGuard 同一套签发逻辑, 不重复实现)
 *   3. 实时查库取 role 与 status
 *   4. 非后台角色 / 账号非 active → 403
 *
 * 为什么实时查库: 见 admin-role.service.ts 顶部说明。
 * JWT 载荷里不含 role, 也不写 status —— 两者都是可变状态。
 */
@Injectable()
export class AdminGuard implements CanActivate {
  private readonly logger = new Logger(AdminGuard.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly roles: AdminRoleService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();

    // 全局守卫: 非后台路径直接放行, 不解析 token。
    // C 端请求不应因后台鉴权链路而失败, 两者职责必须隔离。
    const url: string = request.originalUrl ?? request.url ?? '';
    if (!url.split('?')[0].includes('/admin')) return true;

    const authHeader: string | undefined = request.headers['authorization'];

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new AppError(40101, '未认证', 401);
    }

    const token = authHeader.slice('Bearer '.length).trim();
    let payload: JwtPayload;
    try {
      payload = JwtService.verify(token);
    } catch {
      throw new AppError(40101, '令牌无效或已过期', 401);
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true, role: true, status: true },
    });

    if (!user) throw new AppError(40101, '令牌无效或已过期', 401);
    if (user.status === 'disabled') throw new AppError(40302, '账号已被禁用', 403);
    if (user.status === 'deleted') throw new AppError(40302, '账号已注销', 403);
    if (!isAdminRole(user.role)) {
      // 用 warn 而非 debug: C 端用户误入后台是运营需要察觉的信号
      this.logger.warn(`非后台用户访问后台接口: ${user.email} (role=${user.role})`);
      throw new AppError(40301, '需要管理员权限', 403);
    }

    request.adminUser = { id: user.id, email: user.email, role: user.role };
    return true;
  }
}