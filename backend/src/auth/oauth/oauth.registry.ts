import { Injectable } from '@nestjs/common';
import { buildOAuthProviders } from './oauth.providers';
import { OAuthProvider, OAuthProviderInfo } from './oauth.types';

/**
 * OAuth provider 注册表。
 *
 * 构造时从环境变量装配一次；启用判定 = 凭据齐全 && 显式开关允许。
 */
@Injectable()
export class OAuthRegistryService {
  private readonly providers: OAuthProvider[];
  private readonly enabledIds: Set<string>;

  constructor() {
    this.providers = buildOAuthProviders(process.env);
    this.enabledIds = new Set(
      (process.env.OAUTH_ENABLED ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    );
  }

  list(): OAuthProviderInfo[] {
    return this.providers.map((p) => ({
      id: p.id,
      name: p.name,
      enabled: this.isEnabled(p),
    }));
  }

  /** 未启用或未知 provider 一律返回 undefined，控制器统一报 404 */
  get(id: string): OAuthProvider | undefined {
    const provider = this.providers.find((p) => p.id === id);
    return provider && this.isEnabled(provider) ? provider : undefined;
  }

  private isEnabled(provider: OAuthProvider): boolean {
    if (!provider.enabled) return false;
    return this.enabledIds.size === 0 || this.enabledIds.has(provider.id);
  }
}
