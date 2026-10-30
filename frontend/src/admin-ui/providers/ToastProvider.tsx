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
import { cx } from '../lib/cn';

/**
 * 全局轻提示。
 *
 * ## 为什么自己写
 *
 * 后台原先用 antd 的 `message.*`（约 171 处调用）。整站换到 BoardUI 后
 * antd 的 message 容器会随 `<App>` 一起撤掉，因此这里提供一个同语义的
 * `toast.success/error/info/warning`，调用点只改函数名，不改心智。
 *
 * ## 几条固定规则
 *
 * - 成功 4s、失败 6s：失败信息通常更长，需要更多阅读时间。
 * - 同时最多堆 4 条，超出时挤掉最早的一条 —— 运营连点批量操作时不至于
 *   让提示铺满右半屏。
 * - `aria-live="polite"`，错误用 `role="alert"`；读屏用户能听到结果。
 */

type ToastTone = 'success' | 'error' | 'info' | 'warning';

interface ToastItem {
  id: number;
  tone: ToastTone;
  message: string;
  description?: string;
}

interface ToastApi {
  success: (message: string, description?: string) => void;
  error: (message: string, description?: string) => void;
  info: (message: string, description?: string) => void;
  warning: (message: string, description?: string) => void;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const TONE_META: Record<ToastTone, { icon: typeof Info; className: string }> = {
  success: { icon: CheckCircle2, className: 'text-emerald-600' },
  error: { icon: XCircle, className: 'text-rose-600' },
  warning: { icon: TriangleAlert, className: 'text-amber-600' },
  info: { icon: Info, className: 'text-accent-600' },
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
          className="bui-scope bui-toast-viewport pointer-events-none fixed bottom-6 right-6 z-[1200] flex w-[380px] max-w-[calc(100vw-32px)] flex-col gap-2"
          aria-live="polite"
        >
          {items.map((item) => {
            const { icon: Icon, className } = TONE_META[item.tone];
            return (
              <div
                key={item.id}
                role={item.tone === 'error' ? 'alert' : 'status'}
                className="pointer-events-auto flex items-start gap-2.5 rounded-xl border border-border-table bg-white p-3 shadow-lg"
              >
                <Icon className={cx('mt-0.5 size-4 shrink-0', className)} aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-text-primary">{item.message}</p>
                  {item.description && (
                    <p className="mt-0.5 text-xs leading-5 text-text-tertiary">{item.description}</p>
                  )}
                </div>
                <button
                  type="button"
                  aria-label="关闭提示"
                  className="rounded-md p-0.5 text-text-tertiary transition-colors hover:bg-background-secondary-hover hover:text-text-primary"
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
