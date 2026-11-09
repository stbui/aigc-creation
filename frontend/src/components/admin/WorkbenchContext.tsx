import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { adminApi } from '../../lib/api';
import { useAdmin } from '../../context/AdminContext';
import type { AdminWorkbench, AdminWorkbenchRoleView } from '../../types/api';

const VIEW_STORAGE_PREFIX = 'huojue.admin.view.';
const POLL_MS = 60_000;

interface WorkbenchContextValue {
  data: AdminWorkbench | null;
  loading: boolean;
  error: string | null;
  /** 管理员可切换的预览视角；非管理员始终等于自身角色视角 */
  view: AdminWorkbenchRoleView;
  canSwitchView: boolean;
  setView: (view: AdminWorkbenchRoleView) => void;
  reload: () => void;
}

const WorkbenchContext = createContext<WorkbenchContextValue | null>(null);

function readStoredView(userId: string | undefined): AdminWorkbenchRoleView | null {
  if (!userId) return null;
  try {
    const value = localStorage.getItem(`${VIEW_STORAGE_PREFIX}${userId}`);
    if (value === 'admin' || value === 'operator' || value === 'finance') return value;
  } catch {
    /* localStorage 不可用时按默认视角 */
  }
  return null;
}

function roleView(role: string | undefined): AdminWorkbenchRoleView {
  if (role === 'operator') return 'operator';
  if (role === 'finance') return 'finance';
  return 'admin';
}

/**
 * 角色工作台数据源。
 *
 * 顶栏告警铃铛、`/admin` 首屏与 `/admin/alerts` 的实体行共用这一份快照；
 * 60 秒轮询，页面隐藏时跳过。与 `DutyContext` 分开是因为值班带关心任务
 * 与线路的实时刻度，工作台关心可动作的待办，刷新节奏与失败语义不同。
 *
 * 视角只影响展示分组，后端仍按当前账号权限过滤；非管理员不能切换。
 */
export function AdminWorkbenchProvider({ children }: { children: ReactNode }) {
  const { me } = useAdmin();
  const isAdmin = me?.role === 'admin';
  const [view, setViewState] = useState<AdminWorkbenchRoleView>(() => {
    if (!isAdmin) return roleView(me?.role);
    return readStoredView(me?.id) ?? 'admin';
  });
  const [data, setData] = useState<AdminWorkbench | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    if (isAdmin) return;
    setViewState(roleView(me?.role));
  }, [isAdmin, me?.role]);

  const setView = useCallback(
    (next: AdminWorkbenchRoleView) => {
      if (!isAdmin) return;
      setViewState(next);
      if (me?.id) {
        try {
          localStorage.setItem(`${VIEW_STORAGE_PREFIX}${me.id}`, next);
        } catch {
          /* 存不下就只在本次会话生效 */
        }
      }
    },
    [isAdmin, me?.id],
  );

  const load = useCallback(
    async (silent = false) => {
      if (!me) return;
      const current = ++seq.current;
      if (!silent) setLoading(true);
      try {
        const next = await adminApi.workbench(isAdmin ? view : undefined);
        if (current !== seq.current) return;
        setData(next);
        setError(null);
      } catch (e) {
        if (current !== seq.current) return;
        setError(e instanceof Error ? e.message : '待办加载失败');
      } finally {
        if (current === seq.current && !silent) setLoading(false);
      }
    },
    [isAdmin, me, view],
  );

  useEffect(() => {
    let alive = true;
    const tick = (silent: boolean) => {
      if (!alive || document.visibilityState === 'hidden') return;
      void load(silent);
    };
    void load();
    const timer = window.setInterval(() => tick(true), POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') tick(true);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load]);

  const value = useMemo<WorkbenchContextValue>(
    () => ({
      data,
      loading,
      error,
      view: isAdmin ? view : roleView(me?.role),
      canSwitchView: isAdmin,
      setView,
      reload: () => void load(),
    }),
    [data, error, isAdmin, load, loading, me?.role, setView, view],
  );

  return <WorkbenchContext.Provider value={value}>{children}</WorkbenchContext.Provider>;
}

export function useAdminWorkbench(): WorkbenchContextValue {
  const ctx = useContext(WorkbenchContext);
  if (!ctx) throw new Error('useAdminWorkbench must be used within AdminWorkbenchProvider');
  return ctx;
}
