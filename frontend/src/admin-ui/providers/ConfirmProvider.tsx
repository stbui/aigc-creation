import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Dialog, Heading, Modal, ModalOverlay } from 'react-aria-components';
import { AlertTriangle } from 'lucide-react';
import { Button } from '../../vendor/boardui/components/base/buttons/button';
import { cx } from '../lib/cn';

/**
 * 二次确认。
 *
 * 后台的高危动作（退款 / 删除 / 重置密码 / 调整积分）都必须先说明后果再执行，
 * 其中一部分还要求填写原因并落审计。这套语义原先由 antd `Modal.confirm`
 * 与页面内的 `<ConfirmAction>` 承担；换掉 antd 后统一收敛到 `useConfirm()`。
 *
 * 返回值约定：
 * - `null`  → 用户取消；
 * - `''`    → 用户确认且该动作不需要原因；
 * - `'…'`   → 用户确认并填写的原因（需要原因时不会空串返回）。
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
      <ModalOverlay
        isOpen={pending !== null}
        isDismissable
        onOpenChange={(open) => {
          if (!open) close(null);
        }}
        className="bui-scope fixed inset-0 z-[1100] flex items-center justify-center bg-neutral-950/40 p-6"
      >
        <Modal className="w-full max-w-[480px] outline-none">
          <Dialog
            className="flex flex-col gap-4 rounded-2xl border border-border-table bg-white p-6 shadow-xl outline-none"
            aria-label={pending?.options.title}
          >
            <div className="flex items-start gap-3">
              {pending?.options.danger && (
                <span className="mt-0.5 rounded-full bg-rose-50 p-1.5 text-rose-600">
                  <AlertTriangle className="size-4" aria-hidden />
                </span>
              )}
              <div className="min-w-0 flex-1">
                <Heading slot="title" className="text-base font-semibold text-text-primary">
                  {pending?.options.title}
                </Heading>
                {pending?.options.description && (
                  <div className="mt-1.5 text-sm leading-6 text-text-secondary">
                    {pending.options.description}
                  </div>
                )}
              </div>
            </div>

            {pending?.options.requireReason && (
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-text-secondary">
                  {pending.options.reasonLabel ?? '操作原因'}
                </span>
                <textarea
                  ref={reasonRef}
                  value={reason}
                  onChange={(event) => {
                    setReason(event.target.value);
                    if (error) setError(null);
                  }}
                  rows={3}
                  placeholder={pending.options.reasonPlaceholder ?? '说明为什么执行这个操作'}
                  className={cx(
                    'w-full resize-none rounded-lg border bg-white px-3 py-2 text-sm text-text-primary outline-none',
                    'placeholder:text-text-placeholder focus:border-accent-500 focus:ring-2 focus:ring-accent-200',
                    error ? 'border-red-500' : 'border-border-button-default',
                  )}
                />
                {error && <span className="text-xs text-rose-600">{error}</span>}
              </label>
            )}

            <div className="mt-1 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => close(null)}>
                {pending?.options.cancelText ?? '取消'}
              </Button>
              <Button
                variant={pending?.options.danger ? 'danger' : 'primary'}
                onClick={submit}
              >
                {pending?.options.confirmText ?? '确认'}
              </Button>
            </div>
          </Dialog>
        </Modal>
      </ModalOverlay>
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const confirm = useContext(ConfirmContext);
  if (!confirm) throw new Error('useConfirm 必须在 ConfirmProvider 内使用');
  return confirm;
}
