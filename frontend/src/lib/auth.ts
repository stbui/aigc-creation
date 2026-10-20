const TOKEN_KEY = 'ecom_vision_token';
const EMAIL_KEY = 'ecom_vision_email';
const ROLE_KEY = 'ecom_vision_role';

/** 后台角色 code —— C 端用户为 'user' */
export type StoredRole = 'user' | 'admin' | 'operator' | 'finance';

export const getToken = (): string | null => localStorage.getItem(TOKEN_KEY);
export const setToken = (token: string): void => localStorage.setItem(TOKEN_KEY, token);
export const clearToken = (): void => localStorage.removeItem(TOKEN_KEY);

export const getStoredEmail = (): string | null => localStorage.getItem(EMAIL_KEY);
export const setStoredEmail = (email: string): void => localStorage.setItem(EMAIL_KEY, email);
export const clearStoredEmail = (): void => localStorage.removeItem(EMAIL_KEY);

/**
 * 登录时缓存的角色。
 *
 * 用途只有一个: 判断是否需要展示「进入运营后台」入口。
 * **不是权限依据** —— 权限正确性由后端 /admin/me + PermissionGuard 保证,
 * 这里的值被篡改也拿不到任何越权能力。
 *
 * 存在意义: 避免每个 C 端用户都发一次注定 403 的 /admin/me 请求。
 */
export const getStoredRole = (): StoredRole | null => {
  const raw = localStorage.getItem(ROLE_KEY);
  return raw === 'admin' || raw === 'operator' || raw === 'finance' ? raw : null;
};
export const setStoredRole = (role: string): void => localStorage.setItem(ROLE_KEY, role);
export const clearStoredRole = (): void => localStorage.removeItem(ROLE_KEY);

/** 是否可能是后台用户 (据缓存判断, 可能有误判, 故只用于决定是否发请求) */
export const mayBeAdmin = (): boolean => getStoredRole() !== null;