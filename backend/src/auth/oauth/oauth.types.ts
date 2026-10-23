/**
 * 通用 OAuth 的类型契约。
 *
 * 设计目标：新增一个 provider 不需要改动 AuthService / AuthController，
 * 只需要在 `oauth.providers.ts` 里登记一个实现，并在环境变量里配凭据。
 */

export type OAuthProviderId = string;

export interface OAuthTokenSet {
  accessToken: string;
  refreshToken?: string;
  idToken?: string;
  /** 令牌有效期，单位秒 */
  expiresIn?: number;
  scope?: string;
}

/**
 * provider 侧归一化后的用户资料。
 *
 * subject 是 provider 侧不可变的唯一 id；email 必须已由 provider 确权
 * （emailVerified=false 的邮箱不用于建号/绑号，避免冒充）。
 */
export interface OAuthProfile {
  provider: OAuthProviderId;
  subject: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
  avatarUrl?: string | null;
}

export interface OAuthProvider {
  readonly id: OAuthProviderId;
  readonly name: string;
  /** 只有 clientId + clientSecret + redirectUri 都配齐才可启用 */
  readonly enabled: boolean;
  readonly scopes: string[];

  /** 返回用于跳转 provider 授权页的完整 URL */
  buildAuthorizationUrl(state: string): string;

  /** 用 authorization code 换 token */
  exchange(code: string): Promise<OAuthTokenSet>;

  /** 用 accessToken 拉取并归一化用户资料 */
  fetchProfile(tokens: OAuthTokenSet): Promise<OAuthProfile>;
}

/** 前端「登录方式」列表项，不含任何凭据 */
export interface OAuthProviderInfo {
  id: OAuthProviderId;
  name: string;
  enabled: boolean;
}
