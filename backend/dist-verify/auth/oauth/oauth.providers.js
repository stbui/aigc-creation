"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildOAuthProviders = buildOAuthProviders;
const oauth_http_1 = require("./oauth-http");
class StandardOAuth2Provider {
    constructor(config) {
        this.config = config;
        this.id = config.id;
        this.name = config.name;
        this.scopes = config.scopes;
        this.enabled = Boolean(config.clientId.trim() &&
            config.clientSecret.trim() &&
            config.redirectUri.trim() &&
            config.authorizationEndpoint.trim() &&
            config.tokenEndpoint.trim());
    }
    buildAuthorizationUrl(state) {
        const params = new URLSearchParams({
            response_type: 'code',
            client_id: this.config.clientId,
            redirect_uri: this.config.redirectUri,
            scope: this.scopes.join(' '),
            state,
        });
        return `${this.config.authorizationEndpoint}?${params.toString()}`;
    }
    async exchange(code) {
        const data = await (0, oauth_http_1.postForm)(this.config.tokenEndpoint, {
            grant_type: 'authorization_code',
            code,
            redirect_uri: this.config.redirectUri,
            client_id: this.config.clientId,
            client_secret: this.config.clientSecret,
        });
        return {
            accessToken: data.access_token ?? '',
            refreshToken: data.refresh_token,
            idToken: data.id_token,
            expiresIn: data.expires_in ? Number(data.expires_in) : undefined,
            scope: data.scope,
        };
    }
    async fetchProfile(tokens) {
        if (!tokens.accessToken)
            throw new Error(`${this.name} 未返回 access_token`);
        const json = await (0, oauth_http_1.getJson)(this.config.userinfoEndpoint, tokens.accessToken);
        return this.mapProfile(json);
    }
}
class GoogleOAuthProvider extends StandardOAuth2Provider {
    constructor(config) {
        super(config);
    }
    mapProfile(json) {
        return {
            provider: this.id,
            subject: String(json.sub ?? ''),
            email: json.email ? String(json.email).toLowerCase() : null,
            emailVerified: json.email_verified === true,
            name: json.name ? String(json.name) : null,
            avatarUrl: json.picture ? String(json.picture) : null,
        };
    }
}
class GitHubOAuthProvider extends StandardOAuth2Provider {
    constructor(config) {
        super(config);
    }
    async fetchProfile(tokens) {
        if (!tokens.accessToken)
            throw new Error('GitHub 未返回 access_token');
        const user = await (0, oauth_http_1.getJson)('https://api.github.com/user', tokens.accessToken);
        let email = user.email ? String(user.email).toLowerCase() : null;
        let emailVerified = Boolean(email);
        if (!email) {
            const emails = (await (0, oauth_http_1.getJson)('https://api.github.com/user/emails', tokens.accessToken));
            const primary = emails.find((item) => item.primary === true);
            if (primary?.verified === true && primary.email) {
                email = String(primary.email).toLowerCase();
                emailVerified = true;
            }
        }
        return {
            provider: this.id,
            subject: String(user.id ?? ''),
            email,
            emailVerified,
            name: user.name ? String(user.name) : user.login ? String(user.login) : null,
            avatarUrl: user.avatar_url ? String(user.avatar_url) : null,
        };
    }
    mapProfile(_json) {
        throw new Error('GitHub provider 使用独立 fetchProfile 实现');
    }
}
class GenericOAuthProvider extends StandardOAuth2Provider {
    constructor(config) {
        super(config);
    }
    mapProfile(json) {
        return {
            provider: this.id,
            subject: String(json.sub ?? ''),
            email: json.email ? String(json.email).toLowerCase() : null,
            // 通用 OIDC 若无 email_verified 字段，视为未确权（有字段且为 true 才可信）
            emailVerified: json.email_verified === true,
            name: json.name ? String(json.name) : json.preferred_username ? String(json.preferred_username) : null,
            avatarUrl: json.picture ? String(json.picture) : null,
        };
    }
}
function str(env, key) {
    return (env[key] ?? '').trim();
}
function list(env, key, fallback) {
    const raw = str(env, key);
    return raw ? raw.split(',').map((s) => s.trim()).filter(Boolean) : fallback;
}
function callbackBase(env) {
    const explicit = str(env, 'OAUTH_CALLBACK_BASE');
    if (explicit)
        return explicit.replace(/\/+$/, '');
    return `${str(env, 'WEB_BASE_URL') || 'http://localhost:5100'}/api/v1`.replace(/\/+$/, '');
}
/**
 * 从环境变量构造所有 provider。
 *
 * `enabled` 由三项凭据是否配齐决定，`OAUTH_ENABLED` 只做额外的显式开关：
 * 未配在 `OAUTH_ENABLED` 里的 provider 即使凭据齐全也不启用。
 */
function buildOAuthProviders(env = process.env) {
    const base = callbackBase(env);
    const google = new GoogleOAuthProvider({
        id: 'google',
        name: 'Google',
        clientId: str(env, 'OAUTH_GOOGLE_CLIENT_ID'),
        clientSecret: str(env, 'OAUTH_GOOGLE_CLIENT_SECRET'),
        redirectUri: str(env, 'OAUTH_GOOGLE_REDIRECT_URI') || `${base}/auth/oauth/google/callback`,
        authorizationEndpoint: str(env, 'OAUTH_GOOGLE_AUTHORIZATION_ENDPOINT') || 'https://accounts.google.com/o/oauth2/v2/auth',
        tokenEndpoint: str(env, 'OAUTH_GOOGLE_TOKEN_ENDPOINT') || 'https://oauth2.googleapis.com/token',
        userinfoEndpoint: str(env, 'OAUTH_GOOGLE_USERINFO_ENDPOINT') || 'https://openidconnect.googleapis.com/v1/userinfo',
        scopes: list(env, 'OAUTH_GOOGLE_SCOPES', ['openid', 'email', 'profile']),
    });
    const github = new GitHubOAuthProvider({
        id: 'github',
        name: 'GitHub',
        clientId: str(env, 'OAUTH_GITHUB_CLIENT_ID'),
        clientSecret: str(env, 'OAUTH_GITHUB_CLIENT_SECRET'),
        redirectUri: str(env, 'OAUTH_GITHUB_REDIRECT_URI') || `${base}/auth/oauth/github/callback`,
        authorizationEndpoint: str(env, 'OAUTH_GITHUB_AUTHORIZATION_ENDPOINT') || 'https://github.com/login/oauth/authorize',
        tokenEndpoint: str(env, 'OAUTH_GITHUB_TOKEN_ENDPOINT') || 'https://github.com/login/oauth/access_token',
        userinfoEndpoint: 'https://api.github.com/user',
        scopes: list(env, 'OAUTH_GITHUB_SCOPES', ['read:user', 'user:email']),
    });
    const generic = new GenericOAuthProvider({
        id: 'generic',
        name: str(env, 'OAUTH_GENERIC_NAME') || 'OAuth 2.0',
        clientId: str(env, 'OAUTH_GENERIC_CLIENT_ID'),
        clientSecret: str(env, 'OAUTH_GENERIC_CLIENT_SECRET'),
        redirectUri: str(env, 'OAUTH_GENERIC_REDIRECT_URI') || `${base}/auth/oauth/generic/callback`,
        authorizationEndpoint: str(env, 'OAUTH_GENERIC_AUTHORIZATION_ENDPOINT'),
        tokenEndpoint: str(env, 'OAUTH_GENERIC_TOKEN_ENDPOINT'),
        userinfoEndpoint: str(env, 'OAUTH_GENERIC_USERINFO_ENDPOINT'),
        scopes: list(env, 'OAUTH_GENERIC_SCOPES', ['openid', 'email', 'profile']),
    });
    return [google, github, generic];
}
//# sourceMappingURL=oauth.providers.js.map