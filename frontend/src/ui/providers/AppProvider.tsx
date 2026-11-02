import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { useToast, type ToastApi } from '~/admin-ui/providers/ToastProvider';
import { UiDialog } from '../primitives/dialog';

/**
 * antd `App.useApp()` 的兼容层。
 *
 * 迁移期页面只改 import：`const { message, modal } = useApp()`。
 * - `message.*` 走项目 toast；
 * - `modal.confirm` 走项目确认弹窗，返回 Promise<boolean>；
 * - 不提供 antd 的 notification / contextHolder 等 C 端未使用的能力。
 */
export interface ConfirmOptions {
  title: ReactNode;
  content?: ReactNode;
  okText?: string;
  cancelText?: string;
  okButtonProps?: { danger?: boolean };
  onOk?: () => void | Promise<void>;
}

export interface InfoOptions {
  title: ReactNode;
  content?: ReactNode;
  okText?: string;
  cancelText?: string;
  width?: number;
  okButtonProps?: { danger?: boolean };
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
  /** confirm 有取消/确认两个按钮；info 类只有确认（antd 同此语义） */
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
        danger={Boolean(pending?.options.okButtonProps?.danger)}
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
