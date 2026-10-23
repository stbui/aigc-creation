import * as jwt from 'jsonwebtoken';

// JWT 工具: 使用 HS256, secret 取自环境变量, 缺失时回退 dev 常量。
// 以静态方法暴露, 便于守卫与服务层直接调用, 不依赖 DI。
const JWT_SECRET = process.env.JWT_SECRET || 'dev-ecom-vision-secret-2024-do-not-use-in-prod';
// 本地 MVP 无 refresh token 机制, 15m 会导致演示中频繁掉登录;
// 演示环境放宽到 7 天 (生产应恢复短 TTL + refresh 机制)。
const ACCESS_TOKEN_TTL = process.env.JWT_TTL || '7d';

export interface JwtPayload {
  sub: string; // userId
  email: string;
  /**
   * 令牌版本 (User.tokenVersion 的快照)。
   *
   * 改密 / 重置密码 / 注销时用户表自增, 守卫逐请求比对, 旧 token 立即失效。
   * 缺省按 0 处理 —— 与 `tokenVersion @default(0)` 一致, 存量 token 不受影响。
   */
  tv?: number;
}

export class JwtService {
  static sign(payload: JwtPayload): string {
    return jwt.sign(
      { sub: payload.sub, email: payload.email, tv: payload.tv ?? 0 },
      JWT_SECRET,
      { expiresIn: ACCESS_TOKEN_TTL, algorithm: 'HS256' },
    );
  }

  static verify(token: string): JwtPayload {
    const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] }) as jwt.JwtPayload;
    const tv = decoded.tv == null ? 0 : Number(decoded.tv);
    return { sub: String(decoded.sub), email: String(decoded.email), tv: Number.isFinite(tv) ? tv : 0 };
  }
}
