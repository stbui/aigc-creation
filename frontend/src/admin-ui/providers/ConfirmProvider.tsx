import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';

import { cn } from '../lib/cn';
import { Button } from '../components/ui/button';
import { Button as RadarButton } from '../radar/Button';
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
 *
 * ## 两层视觉边界
 *
 * 弹窗经 Radix Portal 渲染到 `body` 下，拿不到内容区的 `.radar-scope`。后台挂载
 * 时传 `surface="radar"`：12px 圆角、1px 细线、零阴影、15px 标题、12.5px 描述、
 * 32px 行内按钮；C 端保持 `shell`（默认），外观不变。
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

export function ConfirmProvider({
  children,
  /** 浮层视觉边界：后台内容层用 radar 中性语义，C 端保持外壳原样。 */
  surface = 'shell',
}: {
  children: ReactNode;
  surface?: 'shell' | 'radar';
}) {
  const radar = surface === 'radar';
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
          className={cn(
            'max-w-[480px] gap-4',
            radar &&
              'admin-portal radar-scope gap-3 rounded-[12px] border-radar-ink-200 bg-radar-surface p-5 shadow-none',
          )}
          aria-describedby={undefined}
        >
          <DialogHeader>
            <div className="flex items-start gap-3">
              {pending?.options.danger && (
                <span
                  className={cn(
                    'mt-0.5 rounded-full p-1.5',
                    radar
                      ? 'bg-radar-alert-subtle text-radar-alert'
                      : 'bg-danger-soft text-danger-text',
                  )}
                >
                  <AlertTriangle className="size-4" aria-hidden />
                </span>
              )}
              <div className="min-w-0 flex-1">
                <DialogTitle
                  className={cn(
                    'text-base',
                    radar && 'text-[15px] font-semibold text-radar-ink-950',
                  )}
                >
                  {pending?.options.title}
                </DialogTitle>
                {pending?.options.description && (
                  <DialogDescription
                    className={cn(
                      'mt-1.5 text-sm leading-6',
                      radar && 'text-[12.5px] leading-5 text-radar-ink-500',
                    )}
                  >
                    {pending.options.description}
                  </DialogDescription>
                )}
              </div>
            </div>
          </DialogHeader>

          <DialogFooter>
            {radar ? (
              <>
                <RadarButton variant="secondary" size="sm" onClick={() => close(null)}>
                  {pending?.options.cancelText ?? '取消'}
                </RadarButton>
                <RadarButton
                  variant={pending?.options.danger ? 'destructive' : 'default'}
                  size="sm"
                  onClick={submit}
                >
                  {pending?.options.confirmText ?? '确认'}
                </RadarButton>
              </>
            ) : (
              <>
                <Button variant="secondary" onClick={() => close(null)}>
                  {pending?.options.cancelText ?? '取消'}
                </Button>
                <Button
                  variant={pending?.options.danger ? 'destructive' : 'default'}
                  onClick={submit}
                >
                  {pending?.options.confirmText ?? '确认'}
                </Button>
              </>
            )}
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
