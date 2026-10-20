import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { JwtService } from './jwt.service';

/**
 * **可选**鉴权守卫。
 *
 * 与 JwtAuthGuard 的区别: 无 token / token 失效时**放行**而非拒绝,
 * 仅在 token 有效时写入 `request.user`。
 *
 * 存在的唯一理由: 促销弹窗位这类**匿名也要展示**的公开数据,
 * 需要按登录态做人群定向 (如"仅新用户可见")。若一律公开则定向失效,
 * 若强制登录则未登录访客首屏最大的一块转化位直接消失。
 *
 * ⚠ **不要用于任何有副作用的端点**: 放行意味着"没登录也能调"。
 * 写操作用它等于把接口暴露给任何人。
 */
@Injectable()
export class OptionalJwtAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const authHeader: string | undefined = request.headers['authorization'];

    if (!authHeader || !authHeader.startsWith('Bearer ')) return true;

    const token = authHeader.slice('Bearer '.length).trim();
    try {
      const payload = JwtService.verify(token);
      request.user = { id: payload.sub, email: payload.email };
    } catch {
      // 令牌无效按未登录处理: 公开接口不该因过期 token 而 401,
      // 那会让用户刷新页面就白屏, 且掩盖了"这个接口本来就不需要登录"的事实
      request.user = undefined;
    }
    return true;
  }
}