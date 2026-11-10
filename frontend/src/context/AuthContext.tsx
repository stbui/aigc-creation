import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
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

interface AuthContextValue {
  token: string | null;
  email: string | null;
  /** 登录时缓存的角色, 供 AdminContext 决定是否请求后台身份。null = 未知或 C 端用户 */
  role: StoredRole | null;
  login: (
    token: string,
    email: string,
    role?: string,
    mustChangePassword?: boolean,
  ) => void;
  logout: () => void;
  /** 强制改密完成后清除标记（改密会使 token 失效，通常紧接着 logout） */
  clearMustChangePassword: () => void;
  /** 后台重置的临时密码未修改前为 true，App 层据此弹出不可关闭的改密弹窗 */
  mustChangePassword: boolean;
  /**
   * 打开登录弹窗 (2026-10-19「路由对外开放 + 登录挂在顶栏按钮」)。
   * 路由不再拦截未登录访问, 需要身份的动作一律调这个 —— 与参考站同构:
   * 顶栏「登录/注册」按钮点开遮罩弹窗, 登录成功留在原页。
   */
  openLogin: () => void;
  /**
   * 弹窗可见性与身份版本号, 供 `<LoginModalHost>` 渲染。
   *
   * ⚠ 宿主不在这里渲染: AuthCard 内部用 useNavigate() 跳「忘记密码」,
   * 而 AuthProvider 位于 <BrowserRouter> 之外, 在此渲染会抛
   * "useNavigate() may be used only in the context of a <Router> component",
   * 弹窗挂不上 —— 表现为「点登录免费生成毫无反应」。宿主见 App.tsx。
   */
  loginOpen: boolean;
  closeLogin: () => void;
  authEpoch: number;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setTok] = useState<string | null>(() => getToken());
  const [email, setEmail] = useState<string | null>(() => getStoredEmail());
  const [role, setRole] = useState<StoredRole | null>(() => getStoredRole());
  const [loginOpen, setLoginOpen] = useState(false);
  const [mustChangePassword, setMustChangePassword] = useState(false);
  // 登录成功后要让壳内页面重新拉数据 (统计/素材/作品), 这里递增一个版本号作为依赖
  const [authEpoch, setAuthEpoch] = useState(0);

  const openLogin = useCallback(() => setLoginOpen(true), []);
  const closeLogin = useCallback(() => setLoginOpen(false), []);

  const login = useCallback((t: string, e: string, r?: string, mustChange = false) => {
    setToken(t);
    setStoredEmail(e);
    setTok(t);
    setEmail(e);
    setMustChangePassword(mustChange);
    if (r) {
      setStoredRole(r);
      setRole(r === 'admin' || r === 'operator' || r === 'finance' ? r : null);
    }
    // 身份变化 → 壳内页面的统计数据/素材/作品需要重新拉取
    setAuthEpoch((n) => n + 1);
    setLoginOpen(false);
  }, []);

  const logout = useCallback(() => {
    clearToken();
    clearStoredEmail();
    clearStoredRole();
    setTok(null);
    setEmail(null);
    setRole(null);
    setMustChangePassword(false);
  }, []);

  const clearMustChangePassword = useCallback(() => setMustChangePassword(false), []);

  // API 层发现 401 时广播该事件, 同步清空内存态 (路由已对外开放, 不再跳转登录页)
  useEffect(() => {
    const onUnauthorized = () => {
      clearToken();
      clearStoredEmail();
      clearStoredRole();
      setTok(null);
      setEmail(null);
      setRole(null);
      setMustChangePassword(false);
    };
    // 40303：后台重置的临时密码还没改。token 仍有效，只允许 /me 与改密接口。
    const onPasswordChangeRequired = () => setMustChangePassword(true);
    window.addEventListener('auth:unauthorized', onUnauthorized);
    window.addEventListener(
      'auth:password-change-required',
      onPasswordChangeRequired,
    );
    return () => {
      window.removeEventListener('auth:unauthorized', onUnauthorized);
      window.removeEventListener(
        'auth:password-change-required',
        onPasswordChangeRequired,
      );
    };
  }, []);

  // guest 触发了需要身份的动作 (提交/上传): api 层广播该事件 → 打开登录弹窗。
  // 与参考站同构: 未登录点生成不是报「未认证」, 而是弹登录框。
  useEffect(() => {
    const onRequired = () => setLoginOpen(true);
    window.addEventListener('auth:required', onRequired);
    return () => window.removeEventListener('auth:required', onRequired);
  }, []);

  // 全站 Provider：value 必须是稳定引用，否则 loginOpen / authEpoch 等任一 state
  // 变化都会让所有 useAuth() 消费者连带重渲染（同仓其余 Context 均已 memo）。
  const value = useMemo<AuthContextValue>(
    () => ({
      token,
      email,
      role,
      login,
      logout,
      openLogin,
      loginOpen,
      closeLogin,
      authEpoch,
      mustChangePassword,
      clearMustChangePassword,
    }),
    [
      token,
      email,
      role,
      login,
      logout,
      openLogin,
      loginOpen,
      closeLogin,
      authEpoch,
      mustChangePassword,
      clearMustChangePassword,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}