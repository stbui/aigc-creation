import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import {
  getToken,
  setToken,
  clearToken,
  getStoredEmail,
  setStoredEmail,
  clearStoredEmail,
  getStoredRole,
  setStoredRole,
  clearStoredRole,
  type StoredRole,
} from '../lib/auth';
import { LoginModal } from '../components/LoginModal';

interface AuthContextValue {
  token: string | null;
  email: string | null;
  /** 登录时缓存的角色, 供 AdminContext 决定是否请求后台身份。null = 未知或 C 端用户 */
  role: StoredRole | null;
  login: (token: string, email: string, role?: string) => void;
  logout: () => void;
  /**
   * 打开登录弹窗 (2026-10-19「路由对外开放 + 登录挂在顶栏按钮」)。
   * 路由不再拦截未登录访问, 需要身份的动作一律调这个 —— 与参考站同构:
   * 顶栏「登录/注册」按钮点开遮罩弹窗, 登录成功留在原页。
   */
  openLogin: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setTok] = useState<string | null>(() => getToken());
  const [email, setEmail] = useState<string | null>(() => getStoredEmail());
  const [role, setRole] = useState<StoredRole | null>(() => getStoredRole());
  const [loginOpen, setLoginOpen] = useState(false);
  // 登录成功后要让壳内页面重新拉数据 (统计/素材/作品), 这里递增一个版本号作为依赖
  const [authEpoch, setAuthEpoch] = useState(0);

  const openLogin = useCallback(() => setLoginOpen(true), []);
  const closeLogin = useCallback(() => setLoginOpen(false), []);

  const login = (t: string, e: string, r?: string) => {
    setToken(t);
    setStoredEmail(e);
    setTok(t);
    setEmail(e);
    if (r) {
      setStoredRole(r);
      setRole(r === 'admin' || r === 'operator' || r === 'finance' ? r : null);
    }
    // 身份变化 → 壳内页面的统计数据/素材/作品需要重新拉取
    setAuthEpoch((n) => n + 1);
    setLoginOpen(false);
  };

  const logout = () => {
    clearToken();
    clearStoredEmail();
    clearStoredRole();
    setTok(null);
    setEmail(null);
    setRole(null);
  };

  // API 层发现 401 时广播该事件, 同步清空内存态 (路由已对外开放, 不再跳转登录页)
  useEffect(() => {
    const onUnauthorized = () => {
      clearToken();
      clearStoredEmail();
      clearStoredRole();
      setTok(null);
      setEmail(null);
      setRole(null);
    };
    window.addEventListener('auth:unauthorized', onUnauthorized);
    return () => window.removeEventListener('auth:unauthorized', onUnauthorized);
  }, []);

  // guest 触发了需要身份的动作 (提交/上传): api 层广播该事件 → 打开登录弹窗。
  // 与参考站同构: 未登录点生成不是报「未认证」, 而是弹登录框。
  useEffect(() => {
    const onRequired = () => setLoginOpen(true);
    window.addEventListener('auth:required', onRequired);
    return () => window.removeEventListener('auth:required', onRequired);
  }, []);

  return (
    <AuthContext.Provider value={{ token, email, role, login, logout, openLogin }}>
      {children}
      <LoginModal open={loginOpen} onClose={closeLogin} authEpoch={authEpoch} />
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}