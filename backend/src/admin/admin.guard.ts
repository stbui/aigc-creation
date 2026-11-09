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
      select: {
        id: true,
        email: true,
        role: true,
        status: true,
        tokenVersion: true,
        mustChangePassword: true,
        tempPasswordExpiresAt: true,
      },
    });

    if (!user) throw new AppError(40101, '令牌无效或已过期', 401);
    /*
     * 后台也必须比对 tokenVersion：此前只有 C 端 JwtAuthGuard 做这件事，
     * 管理员改密 / 被重置密码后，旧后台 token 仍能继续调用管理接口 ——
     * 「改密后所有旧会话失效」不能只在 C 端成立。
     */
    if ((payload.tv ?? 0) !== user.tokenVersion) {
      throw new AppError(40102, '密码已变更，请重新登录', 401);
    }
    if (user.status === 'disabled') throw new AppError(40302, '账号已被禁用', 403);
    if (user.status === 'deleted') throw new AppError(40302, '账号已注销', 403);
    if (!isAdminRole(user.role)) {
      // 用 warn 而非 debug: C 端用户误入后台是运营需要察觉的信号
      this.logger.warn(`非后台用户访问后台接口: ${user.email} (role=${user.role})`);
      throw new AppError(40301, '需要管理员权限', 403);
    }

    /*
     * 后台账号被重置密码后同样必须先在 C 端 /me/password 改密。
     * 全局强制改密弹窗不依赖后台外壳，因此这里拦下 /admin/* 不会让用户
     * 无路可走；不拦则临时密码会变成长期有效的后台密码。
     */
    if (user.mustChangePassword) {
      if (
        user.tempPasswordExpiresAt &&
        user.tempPasswordExpiresAt.getTime() <= Date.now()
      ) {
        throw new AppError(40304, '临时密码已过期，请联系管理员重新重置', 403);
      }
      throw new AppError(40303, '首次登录请先修改密码', 403);
    }

    request.adminUser = { id: user.id, email: user.email, role: user.role };
    return true;
  }
}