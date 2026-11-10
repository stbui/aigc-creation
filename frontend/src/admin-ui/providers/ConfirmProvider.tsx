import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';

import { Button } from '../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';

/**
 * 二次确认。
 *
 * 后台业务动作（退款 / 删除 / 重置密码 / 调整积分）先说明后果再执行。
 * 业务需要依据的动作由各自表单收集原因。
 *
 * 返回值约定：
 * - `null` → 用户取消；
 * - `''`   → 用户确认。
 */
export interface ConfirmOptions {
  title: string;
  description?: ReactNode;
  confirmText?: string;
  cancelText?: string;
  /** 危险动作用红色主按钮 */
  danger?: boolean;
}

type ConfirmFn = (options: ConfirmOptions) => Promise<string | null>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

interface PendingConfirm {
  options: ConfirmOptions;
  resolve: (value: string | null) => void;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingConfirm | null>(null);

  const confirm = useCallback<ConfirmFn>(
    (options) => new Promise<string | null>((resolve) => setPending({ options, resolve })),
    [],
  );

  const close = useCallback(
    (value: string | null) => {
      pending?.resolve(value);
      setPending(null);
    },
    [pending],
  );

  const submit = () => close('');

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
