import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { creditsApi } from '../lib/api';
import type { CreditBalance } from '../types/api';
import { useAuth } from './AuthContext';

/**
 * 积分余额全局状态。
 *
 * 为什么要 Context 而不是各页各拉一次:
 * 顶导要显示余额、工具页要判断「够不够扣」、提交失败要提示差多少 ——
 * 三处都要同一个值, 各拉各的会出现「顶导显示 100, 点提交却提示不足」。
 *
 * ⚠ **余额只读不推算**: 前端不做任何加减, 全部以服务端为准。
 * 本地扣减看似省一次请求, 实际会在并发/失败重试时与真实账本漂移 ——
 * 而积分是资损方向, 宁可多一次请求也不能让用户看到的数字是猜的。
 *
 * 刷新时机: 登录后 / 退出后 / 生成任务成功或失败后 (扣费或退还都可能发生)。
 * 刻意不做轮询 —— 余额变动只由本站自己的写操作引起, 广播事件即可覆盖。
 */
interface CreditsContextValue {
  balance: CreditBalance | null;
  loading: boolean;
  error: string | null;
  /** 手动/事件触发重新拉取 */
  refresh: () => Promise<void>;
}

const CreditsContext = createContext<CreditsContextValue |null>(null);

export function CreditsProvider({ children }: { children: ReactNode }) {
  const { token } = useAuth();
  const [balance, setBalance] = useState<CreditBalance | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    // 未登录不请求 —— /credits/balance 需要鉴权, 发了也只是拿一个 401
    if (!token) {
      setBalance(null);
      setError(null);
      return;
    }
    setLoading(true);
    try {
      setBalance(await creditsApi.balance());
      setError(null);
    } catch (e) {
      /*
       * 余额拉取失败**不抛给调用方**: 顶导只是显示, 失败时显示占位即可,
       * 让整个应用崩在「余额取不到」上不成比例。
       */
      setError((e as Error)?.message ?? '余额加载失败');
    } finally {
      setLoading(false);
    }
  }, [token]);

  // 登录/退出时同步一次
  useEffect(() => {
    void refresh();
  }, [refresh]);

  /*
   * 订阅余额变更广播。
   *
   * 生成任务扣费、支付成功发积分都发生在别处, 靠事件通知这里刷新。
   * 不轮询是因为余额只由本站写操作引起, 事件覆盖已完整 ——
   * 轮询会在用户挂着页面时持续打接口, 而余额并不会自己变。
   */
  useEffect(() => {
    const handler = () => void refresh();
    window.addEventListener('credits:changed', handler);
    return () => window.removeEventListener('credits:changed', handler);
  }, [refresh]);

  const value = useMemo(
    () => ({ balance, loading, error, refresh }),
    [balance, loading, error, refresh],
  );

  return <CreditsContext.Provider value={value}>{children}</CreditsContext.Provider>;
}

export function useCredits(): CreditsContextValue {
  const ctx = useContext(CreditsContext);
  // 不用 useAuth 兜底: Provider 未挂载是接线错误, 静默返回空值会让余额
  // 永远显示占位而没人发现, 直接抛出来更早暴露问题
  if (!ctx) throw new Error('useCredits 必须在 CreditsProvider 内使用');
  return ctx;
}

/**
 * 广播余额变更。
 *
 * 在扣费/发积分的调用点触发, 避免各处自己记得刷新 —— 漏一处就会显示陈旧余额。
 */
export function notifyCreditsChanged(): void {
  window.dispatchEvent(new Event('credits:changed'));
}