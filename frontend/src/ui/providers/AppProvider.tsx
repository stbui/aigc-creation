import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { useToast, type ToastApi } from '~/admin-ui/providers/ToastProvider';
import { UiDialog } from '../primitives/dialog';

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

  return (
    <AppContext.Provider value={api}>
      {children}
      <UiDialog
        open={pending !== null}
        title={pending?.options.title}
        description={pending?.options.content}
        confirmText={pending?.options.okText ?? '确定'}
        cancelText={pending?.options.cancelText}
        hideCancel={pending?.kind === 'info'}
        danger={pending?.options.danger}
        onCancel={() => close(false)}
        onConfirm={() => {
          const options = pending?.options;
          close(true);
          void options?.onOk?.();
        }}
      />
    </AppContext.Provider>
  );
}

export function useApp(): AppApi {
  const api = useContext(AppContext);
  if (!api) throw new Error('useApp 必须在 AppProvider 内使用');
  return api;
}
