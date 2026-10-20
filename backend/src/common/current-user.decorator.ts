import { createParamDecorator, ExecutionContext } from '@nestjs/common';

// 提取当前登录用户: @CurrentUser() user
export interface AuthUser {
  id: string;
  email: string;
}

/**
 * 提取当前登录用户。
 *
 * 返回类型保持 `AuthUser` 而非 `AuthUser | undefined`: 本装饰器的全部既有调用点
 * (20+ 端点)都挂在 JwtAuthGuard 之下, 守卫失败即抛 401, 走到 handler 时
 * `request.user` 必然存在。改成可选联合类型会让所有 `user.id` 调用点报类型错,
 * 而它们实际不可能为空 —— 那是编译期噪音, 反而会诱使人到处加 `!`。
 *
 * 公开端点(可登录可不登录, 如促销弹窗位)请直接用 `@Req()` 读 `request.user`:
 * 它天然可选, 类型不会骗人。
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const request = ctx.switchToHttp().getRequest();
    return request.user as AuthUser;
  },
);