import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AlertTriangle } from 'lucide-react';

import { cn } from '../lib/cn';
import { Button } from '../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';
import { Textarea } from '../components/ui/textarea';

/**
 * 二次确认。
 *
 * 后台的高危动作（退款 / 删除 / 重置密码 / 调整积分）都必须先说明后果再执行，
 * 其中一部分还要求填写原因并落审计。
 *
 * 返回值约定：
 * - `null`  → 用户取消；
 * - `''`    → 用户确认且该动作不需要原因；
 * - `'…'`   → 用户确认并填写的原因（需要原因时不会返回空串）。
 */
export interface ConfirmOptions {
  title: string;
  description?: ReactNode;
  confirmText?: string;
  cancelText?: string;
  /** 危险动作用红色主按钮 */
  danger?: boolean;
  /** 高危动作：必须填写原因，返回值即原因文本 */
  requireReason?: boolean;
  reasonLabel?: string;
  reasonPlaceholder?: string;
}

type ConfirmFn = (options: ConfirmOptions) => Promise<string | null>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

interface PendingConfirm {
  options: ConfirmOptions;
  resolve: (value: string | null) => void;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const reasonRef = useRef<HTMLTextAreaElement | null>(null);

  const confirm = useCallback<ConfirmFn>(
    (options) => new Promise<string | null>((resolve) => setPending({ options, resolve })),
    [],
  );

  const close = useCallback(
    (value: string | null) => {
      pending?.resolve(value);
      setPending(null);
      setReason('');
      setError(null);
    },
    [pending],
  );

  // 需要原因时把焦点直接放到输入框，少一次 Tab
  useEffect(() => {
    if (pending?.options.requireReason) {
      const timer = window.setTimeout(() => reasonRef.current?.focus(), 30);
      return () => window.clearTimeout(timer);
    }
  }, [pending]);

  const submit = () => {
    if (!pending) return;
    if (pending.options.requireReason && reason.trim().length === 0) {
      setError('请填写操作原因，原因会写入审计记录');
      reasonRef.current?.focus();
      return;
    }
    close(reason.trim());
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Dialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) close(null);
        }}
      >
        <DialogContent
          data-testid="admin-confirm-dialog"
          className="max-w-[480px] gap-4"
          aria-describedby={undefined}
        >
          <DialogHeader>
            <div className="flex items-start gap-3">
              {pending?.options.danger && (
                <span className="mt-0.5 rounded-full bg-danger-soft p-1.5 text-danger-text">
                  <AlertTriangle className="size-4" aria-hidden />
                </span>
              )}
              <div className="min-w-0 flex-1">
                <DialogTitle className="text-base">{pending?.options.title}</DialogTitle>
                {pending?.options.description && (
                  <DialogDescription className="mt-1.5 text-sm leading-6">
                    {pending.options.description}
                  </DialogDescription>
                )}
              </div>
            </div>
          </DialogHeader>

          {pending?.options.requireReason && (
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-foreground">
                {pending.options.reasonLabel ?? '操作原因'}
              </span>
              <Textarea
                ref={reasonRef}
                value={reason}
                onChange={(event) => {
                  setReason(event.target.value);
                  if (error) setError(null);
                }}
                rows={3}
                placeholder={pending.options.reasonPlaceholder ?? '说明为什么执行这个操作'}
                aria-invalid={error ? true : undefined}
                className={cn('resize-none text-sm', error && 'border-destructive')}
              />
              {error && <span className="text-xs text-danger-text">{error}</span>}
            </label>
          )}

          <DialogFooter>
            <Button variant="secondary" onClick={() => close(null)}>
              {pending?.options.cancelText ?? '取消'}
            </Button>
            <Button variant={pending?.options.danger ? 'destructive' : 'default'} onClick={submit}>
              {pending?.options.confirmText ?? '确认'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const confirm = useContext(ConfirmContext);
  if (!confirm) throw new Error('useConfirm 必须在 ConfirmProvider 内使用');
  return confirm;
}

/**
 * 可选版本：不在 `ConfirmProvider` 内时返回 `null`。
 *
 * 给共享 hook 用 —— 丢弃未保存变更的确认既要服务后台页面，也不能在没挂
 * Provider 的环境里抛错（那样连「有没有改过」都问不出来，会直接白屏）。
 */
export function useOptionalConfirm(): ConfirmFn | null {
  return useContext(ConfirmContext);
}
