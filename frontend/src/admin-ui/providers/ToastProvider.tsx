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
import { createPortal } from 'react-dom';
import { CheckCircle2, Info, TriangleAlert, X, XCircle } from 'lucide-react';
import { cn } from '../lib/cn';

/**
 * 全局轻提示。
 *
 * ## 为什么自己写
 *
 * 后台有约 170 处「操作完给个反馈」。一条 toast 需要的东西很少（堆叠上限、
 * 自动消失、读屏播报），引一个库反而要多带一套主题变量。这里只依赖
 * `portal` + 项目的语义色令牌。
 *
 * ## 几条固定规则
 *
 * - 成功 4s、警示 5s、失败 6s —— 失败信息通常更长，需要更多阅读时间；
 * - 同时最多 4 条，超出挤掉最早的一条 —— 连点批量操作时不至于铺满右半屏；
 * - `aria-live="polite"`，错误用 `role="alert"`，读屏用户能听到结果。
 */

type ToastTone = 'success' | 'error' | 'info' | 'warning';

interface ToastItem {
  id: number;
  tone: ToastTone;
  message: string;
  description?: string;
}

export interface ToastApi {
  success: (message: string, description?: string) => void;
  error: (message: string, description?: string) => void;
  info: (message: string, description?: string) => void;
  warning: (message: string, description?: string) => void;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const TONE_META: Record<ToastTone, { icon: typeof Info; className: string }> = {
  success: { icon: CheckCircle2, className: 'text-success-text' },
  error: { icon: XCircle, className: 'text-danger-text' },
  warning: { icon: TriangleAlert, className: 'text-warn-text' },
  info: { icon: Info, className: 'text-brand' },
};

const MAX_TOASTS = 4;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);
  const timers = useRef(new Map<number, number>());

  const dismiss = useCallback((id: number) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      window.clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const push = useCallback(
    (tone: ToastTone, message: string, description?: string) => {
      const id = ++seq.current;
      setItems((prev) => [...prev.slice(-(MAX_TOASTS - 1)), { id, tone, message, description }]);
      const timer = window.setTimeout(
        () => dismiss(id),
        tone === 'error' ? 6000 : tone === 'warning' ? 5000 : 4000,
      );
      timers.current.set(id, timer);
    },
    [dismiss],
  );

  // 卸载时清掉所有定时器，避免开发态热更新后残留回调 setState
  useEffect(() => {
    const map = timers.current;
    return () => {
      map.forEach((timer) => window.clearTimeout(timer));
      map.clear();
    };
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      success: (message, description) => push('success', message, description),
      error: (message, description) => push('error', message, description),
      info: (message, description) => push('info', message, description),
      warning: (message, description) => push('warning', message, description),
      dismiss,
    }),
    [push, dismiss],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      {createPortal(
        <div
          className="admin-portal pointer-events-none fixed right-6 bottom-6 z-[1200] flex w-[380px] max-w-[calc(100vw-32px)] flex-col gap-2"
          aria-live="polite"
        >
          {items.map((item) => {
            const { icon: Icon, className } = TONE_META[item.tone];
            return (
              <div
                key={item.id}
                data-testid="admin-toast"
                role={item.tone === 'error' ? 'alert' : 'status'}
                className="pointer-events-auto flex items-start gap-2.5 rounded-lg border border-border bg-popover p-3 text-popover-foreground shadow-lg"
              >
                <Icon className={cn('mt-0.5 size-4 shrink-0', className)} aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground">{item.message}</p>
                  {item.description && (
                    <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                      {item.description}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  aria-label="关闭提示"
                  className="rounded-md p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  onClick={() => dismiss(item.id)}
                >
                  <X className="size-3.5" aria-hidden />
                </button>
              </div>
            );
          })}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error('useToast 必须在 ToastProvider 内使用');
  return api;
}
