import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfigValues } from '../config/env.validation';
import * as jwt from 'jsonwebtoken';

// JWT 工具: 使用 HS256。
// 密钥与 TTL 通过 ConfigService 读取（jwt.secret / jwt.ttl），不在模块加载期
// 把 process.env 固化成常量 —— 配置层是唯一事实源，也便于测试注入。

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

@Injectable()
export class JwtService {
  constructor(private readonly config: ConfigService<AppConfigValues, true>) {}

  sign(payload: JwtPayload): string {
    return jwt.sign(
      { sub: payload.sub, email: payload.email, tv: payload.tv ?? 0 },
      this.secret(),
      { expiresIn: this.ttl(), algorithm: 'HS256' },
    );
  }

  verify(token: string): JwtPayload {
    const decoded = jwt.verify(token, this.secret(), {
      algorithms: ['HS256'],
    }) as jwt.JwtPayload;
    const tv = decoded.tv == null ? 0 : Number(decoded.tv);
    return {
      sub: String(decoded.sub),
      email: String(decoded.email),
      tv: Number.isFinite(tv) ? tv : 0,
    };
  }

  private secret(): string {
    return this.config.get<string>('jwt.secret') || 'dev-huojue-secret-do-not-use-in-prod';
  }

  private ttl(): string {
    // 本地 MVP 无 refresh token 机制, 15m 会导致演示中频繁掉登录;
    // 演示环境放宽到 7 天 (生产应恢复短 TTL + refresh 机制)。
    return this.config.get<string>('jwt.ttl') || '7d';
  }
}
