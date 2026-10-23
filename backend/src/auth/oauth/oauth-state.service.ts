import * as jwt from 'jsonwebtoken';

/**
 * OAuth state 与回调后的短时登录票。
 *
 * state 是浏览器跳转期间防 CSRF 的一次性凭据；登录票是「provider 回调 →
 * 前端登录完成页」之间的短时接力凭据，避免把 7 天的 accessToken 放进 URL。
 */

const JWT_SECRET = process.env.JWT_SECRET || 'dev-ecom-vision-secret-2024-do-not-use-in-prod';

const STATE_TTL = '10m';
const TICKET_TTL = '60s';

export interface OAuthStatePayload {
  provider: string;
  /** 登录完成后回跳的站内路径。未提供时回落 /workbench */
  returnTo?: string;
}

export interface OAuthTicketPayload {
  sub: string;
  provider: string;
}

export class OAuthStateService {
  signState(payload: OAuthStatePayload): string {
    return jwt.sign(payload, JWT_SECRET, { expiresIn: STATE_TTL, algorithm: 'HS256' });
  }

  verifyState(token: string, provider: string): OAuthStatePayload {
    let payload: unknown;
    try {
      payload = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
    } catch {
      throw new Error('OAuth state 无效或已过期，请重新发起登录');
    }
    const decoded = payload as jwt.JwtPayload & OAuthStatePayload;
    if (!decoded.provider || decoded.provider !== provider) {
      throw new Error('OAuth state 与 provider 不匹配，请重新发起登录');
    }
    return {
      provider: String(decoded.provider),
      returnTo: decoded.returnTo ? String(decoded.returnTo) : undefined,
    };
  }

  signTicket(payload: OAuthTicketPayload): string {
    return jwt.sign(payload, JWT_SECRET, { expiresIn: TICKET_TTL, algorithm: 'HS256' });
  }

  verifyTicket(token: string): OAuthTicketPayload {
    let payload: unknown;
    try {
      payload = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
    } catch {
      throw new Error('OAuth 登录票无效或已过期，请重新登录');
    }
    const decoded = payload as jwt.JwtPayload & OAuthTicketPayload;
    if (!decoded.sub) throw new Error('OAuth 登录票缺少用户标识');
    return { sub: String(decoded.sub), provider: String(decoded.provider ?? '') };
  }
}
