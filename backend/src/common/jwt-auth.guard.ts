import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { AppError } from './app.exception';
import { JwtPayload, JwtService } from './jwt.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Bearer Token 鉴权守卫: 校验 Authorization 头, 解析后将用户写入 request.user。
 *
 * ## 为什么每次请求都要查一次库 (2026-10-21)
 *
 * 此前只验签名 —— token 有效期 7 天, 意味着后台禁用/注销一个账号后,
 * 该用户仍能凭旧 token 继续调 20+ 个接口, 直到 token 自然过期。
 * 「禁用立即生效」是账号体系的基本承诺, 不能靠 token 过期兜底。
 *
 * 代价是一次按主键的 SQLite 查询 (只取 status 一列), 与业务查询相比可忽略;
 * 不做内存缓存的理由: 缓存窗口内被禁用的账号仍可用, 正好把"立即生效"
 * 退化成"几秒后生效" —— 省下的这点开销不值得。
 *
 * 账号被**硬删除**时查不到记录, 同样按未认证处理。
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
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
      select: { id: true, email: true, status: true, tokenVersion: true },
    });
    if (!user) {
      // 账号已被硬删除: 签名仍然有效, 但主体已不存在
      throw new AppError(40101, '账号不存在或已注销', 401);
    }
    /*
     * 令牌版本比对: 改密 / 重置密码 / 注销会把 User.tokenVersion 自增,
     * 持旧 token 的会话在下一次请求即失效 —— 这是「改密后踢掉所有旧会话」
     * 的唯一实现, 不依赖黑名单表。
     */
    if ((payload.tv ?? 0) !== user.tokenVersion) {
      throw new AppError(40102, '密码已变更，请重新登录', 401);
    }
    if (user.status === 'disabled') {
      throw new AppError(40302, '账号已被禁用', 403);
    }
    if (user.status === 'deleted') {
      throw new AppError(40302, '账号已注销', 403);
    }

    request.user = { id: user.id, email: user.email };
    return true;
  }
}
