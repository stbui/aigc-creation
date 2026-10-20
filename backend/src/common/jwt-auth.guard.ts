import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { AppError } from './app.exception';
import { JwtPayload, JwtService } from './jwt.service';

// Bearer Token 鉴权守卫: 校验 Authorization 头, 解析后将用户写入 request.user
@Injectable()
export class JwtAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
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

    request.user = { id: payload.sub, email: payload.email };
    return true;
  }
}
