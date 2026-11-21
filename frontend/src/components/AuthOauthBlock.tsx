import { oauthAuthorizeUrl, type OAuthProviderInfo } from '../lib/api';

/**
 * 通用 OAuth 登录入口。
 *
 * 只有后端 `/auth/oauth/providers` 返回已启用项才渲染 —— 没有配置的渠道
 * 不显示按钮，避免用户点到一个必然失败的入口。回跳地址取当前页，
 * 登录完成后回到用户原本要看的内容。
 */
export function AuthOauthBlock({ providers }: { providers: OAuthProviderInfo[] }) {
  if (providers.length === 0) return null;

  return (
    <div className="login-oauth">
      <span className="login-oauth-divider">或</span>
      {providers.map((provider) => (
        <button
          key={provider.id}
          type="button"
          className="login-oauth-btn"
          onClick={() => {
            const returnTo = window.location.pathname + window.location.search;
            window.location.assign(oauthAuthorizeUrl(provider.id, returnTo));
          }}
        >
          使用 {provider.name} 登录
        </button>
      ))}
    </div>
  );
}
