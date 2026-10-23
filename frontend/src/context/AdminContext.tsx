import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { adminApi, ApiError } from '../lib/api';
import { mayBeAdmin } from '../lib/auth';
import type { AdminMe } from '../types/api';
import { useAuth } from './AuthContext';

interface AdminContextValue {
  /** 当前后台用户; null 表示尚未加载或加载失败 */
  me: AdminMe | null;
  loading: boolean;
  error: string | null;
  /**
   * 失败时的 HTTP 状态码 (0 = 网络中断 / 非 HTTP 错误)。
   *
   * 路由层要靠它区分「你没有后台权限」(401/403) 与「后台没连上」(0/5xx)，
   * 只看 error 文案会把断网也渲染成「需要后台权限」。
   */
  errorStatus: number | null;
  /**
   * 权限判定。
   *
   * ⚠ 仅用于隐藏无权操作的按钮, **不是安全边界** —— 真正的校验在后端
   * PermissionGuard。前端可绕过, 后端不可绕过。
   */
  can: (permission: string) => boolean;
  canAny: (...permissions: string[]) => boolean;
  /** 该权限点是否需要输入操作原因 (删除/退款/调价等高危动作) */
  isHighRisk: (permission: string) => boolean;
  refresh: () => void;
}

const AdminContext = createContext<AdminContextValue | null>(null);

export function AdminProvider({ children }: { children: ReactNode }) {
  const { token } = useAuth();
  const [me, setMe] = useState<AdminMe | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    // 无 token 不请求
    if (!token) {
      setMe(null);
      setLoading(false);
      setError(null);
      setErrorStatus(null);
      return;
    }

    // C 端用户不发请求: 登录时缓存的角色不是后台角色就没必要打 /admin/me。
    // 误判代价可接受 —— 缓存说是后台但实际不是, 只是多一次 403;
    // 反过来 (真后台但缓存缺失, 如换了浏览器) 由下方的 403 分支兜住, 只会
    // 少显示入口而不会越权。
    if (!mayBeAdmin()) {
      setMe(null);
      setLoading(false);
      setError(null);
      setErrorStatus(null);
      return;
    }

    let alive = true;
    setLoading(true);
    adminApi
      .me()
      .then((data) => {
        if (!alive) return;
        setMe(data);
        setError(null);
        setErrorStatus(null);
      })
      .catch((e: unknown) => {
        if (!alive) return;
        // 不静默: 非管理员访问后台时需要明确的失败原因用于路由决策
        setMe(null);
        setError(e instanceof Error ? e.message : '无法获取后台身份');
        setErrorStatus(e instanceof ApiError ? e.status : 0);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [token, nonce]);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  const permissionSet = useMemo(() => new Set(me?.permissions ?? []), [me]);
  const highRiskSet = useMemo(() => new Set(me?.highRiskPermissions ?? []), [me]);

  const value = useMemo<AdminContextValue>(
    () => ({
      me,
      loading,
      error,
      errorStatus,
      can: (p) => permissionSet.has(p),
      canAny: (...ps) => ps.some((p) => permissionSet.has(p)),
      isHighRisk: (p) => highRiskSet.has(p),
      refresh,
    }),
    [me, loading, error, errorStatus, permissionSet, highRiskSet, refresh],
  );

  return <AdminContext.Provider value={value}>{children}</AdminContext.Provider>;
}

export function useAdmin(): AdminContextValue {
  const ctx = useContext(AdminContext);
  if (!ctx) throw new Error('useAdmin must be used within AdminProvider');
  return ctx;
}