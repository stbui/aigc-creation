import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { useToast, type ToastApi } from '~/admin-ui/providers/ToastProvider';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/admin-ui/components/ui/dialog';
import { Button } from '~/admin-ui/components/ui/button';

/**
 * C 端反馈 API：toast 与确认弹窗。
 *
 * - `message.*` 走项目 toast；
 * - `modal.confirm` 走项目确认弹窗，返回 Promise<boolean>；
 * - 只暴露 C 端实际使用的能力，不保留旧库的 notification / contextHolder。
 */
export interface ConfirmOptions {
  title: ReactNode;
  content?: ReactNode;
  okText?: string;
  cancelText?: string;
  danger?: boolean;
  onOk?: () => void | Promise<void>;
}

export interface InfoOptions {
  title: ReactNode;
  content?: ReactNode;
  okText?: string;
  cancelText?: string;
  width?: number;
  danger?: boolean;
  onOk?: () => void | Promise<void>;
}

export interface AppApi {
  message: ToastApi;
  modal: {
    confirm: (options: ConfirmOptions) => Promise<boolean>;
    info: (options: InfoOptions) => Promise<boolean>;
    success: (options: InfoOptions) => Promise<boolean>;
    error: (options: InfoOptions) => Promise<boolean>;
    warning: (options: InfoOptions) => Promise<boolean>;
  };
}

interface PendingConfirm {
  options: ConfirmOptions | InfoOptions;
  resolve: (value: boolean) => void;
  /** confirm 有取消/确认两个按钮；info 类只有确认 */
  kind: 'confirm' | 'info';
}

const AppContext = createContext<AppApi | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const message = useToast();
  const [pending, setPending] = useState<PendingConfirm | null>(null);

  const close = useCallback(
    (value: boolean) => {
      pending?.resolve(value);
      setPending(null);
    },
    [pending],
  );

  const api = useMemo<AppApi>(
    () => {
      const open = (kind: 'confirm' | 'info', options: ConfirmOptions | InfoOptions) =>
        new Promise<boolean>((resolve) => {
          setPending({ options, resolve, kind });
        });
      return {
        message,
        modal: {
          confirm: (options) => open('confirm', options),
          info: (options) => open('info', options),
          success: (options) => open('info', options),
          error: (options) => open('info', options),
          warning: (options) => open('info', options),
        },
      };
    },
    [message],
  );

  const options = pending?.options;
  const isInfo = pending?.kind === 'info';
  const width = options && 'width' in options ? options.width : undefined;

  return (
    <AppContext.Provider value={api}>
      {children}
      <Dialog open={pending !== null} onOpenChange={(next) => !next && close(false)}>
        <DialogContent
          data-testid="ui-app-dialog"
          className="gap-4 p-6"
          style={{ maxWidth: width ?? (options?.content ? 560 : 480) }}
          showCloseButton={false}
        >
          <DialogHeader>
            <DialogTitle className="text-base">{options?.title}</DialogTitle>
            {options?.content && (
              <DialogDescription className="mt-1.5 text-sm leading-6">
                {options.content}
              </DialogDescription>
            )}
          </DialogHeader>
          <DialogFooter>
            {!isInfo && (
              <Button variant="secondary" onClick={() => close(false)}>
                {options?.cancelText ?? '取消'}
              </Button>
            )}
            <Button
              variant={options?.danger ? 'destructive' : 'default'}
              onClick={() => {
                const current = pending?.options;
                close(true);
                void current?.onOk?.();
              }}
            >
              {options?.okText ?? '确定'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppContext.Provider>
  );
}

export function useApp(): AppApi {
  const api = useContext(AppContext);
  if (!api) throw new Error('useApp 必须在 AppProvider 内使用');
  return api;
}
