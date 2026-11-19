import type { CSSProperties, ReactNode } from 'react';
import {
  Dialog,
  DialogDescription,
  DialogOverlay,
  DialogTitle,
} from '~/admin-ui/components/ui/dialog';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { cn } from '../lib/cn';

export interface ModalProps {
  open: boolean;
  title?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode | null;
  onCancel?: () => void;
  onOk?: () => void;
  okText?: string;
  cancelText?: string;
  width?: number | string;
  /** 弹窗定位：居中（默认）或距顶部固定偏移。 */
  position?: 'center' | 'top';
  /** 关闭后保留 DOM 状态；默认卸载。 */
  keepMounted?: boolean;
  closable?: boolean;
  /** 点击遮罩是否关闭；默认 true。 */
  closeOnMaskClick?: boolean;
  /** 确认按钮状态。 */
  confirmState?: { danger?: boolean; disabled?: boolean; loading?: boolean };
  cancelDisabled?: boolean;
  className?: string;
  styles?: { body?: CSSProperties; mask?: CSSProperties; container?: CSSProperties };
  keyboard?: boolean;
  closeIcon?: ReactNode;
}

/**
 * C 端 Modal 组合件：Radix Dialog 负责焦点陷阱、Esc、遮罩关闭与焦点归位，
 * 外观由 shadcn 的 dialog-* 槽位与页面级类共同定义。
 *
 * `className` 与 `ui-modal-surface` 挂在同一个元素上，页面级容器规则
 * 使用 `.alp-modal` / `.mum-modal` / `.login-modal` 即可，无需依赖伪类。
 */
export function Modal({
  open,
  title,
  children,
  footer,
  onCancel,
  onOk,
  okText = '确定',
  cancelText = '取消',
  width = 520,
  position = 'center',
  keepMounted,
  closable = true,
  closeOnMaskClick = true,
  className,
  styles,
  keyboard = true,
  closeIcon,
  confirmState,
  cancelDisabled,
}: ModalProps) {
  const okDisabled = Boolean(confirmState?.loading || confirmState?.disabled);
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onCancel?.()}>
      <DialogPrimitive.Portal forceMount={keepMounted || undefined}>
        <DialogOverlay
          forceMount={keepMounted || undefined}
          hidden={keepMounted && !open}
          style={styles?.mask}
        />
        <DialogPrimitive.Content
          forceMount={keepMounted || undefined}
          hidden={keepMounted && !open}
          className={cn('ui-modal-content', position === 'center' ? 'is-centered' : 'is-top')}
          style={{
            maxWidth: width,
            ...(position === 'top' ? { top: 100, transform: 'translateX(-50%)' } : {}),
          }}
          onEscapeKeyDown={keyboard ? undefined : (event) => event.preventDefault()}
          onPointerDownOutside={closeOnMaskClick ? undefined : (event) => event.preventDefault()}
          onOpenAutoFocus={
            title ? (event) => event.preventDefault() : undefined
          }
        >
          <div
            className={cn('ui-modal-surface', className)}
            data-slot="c-modal-container"
            style={styles?.container}
          >
            {title && (
              <div className="ui-modal-head" data-slot="c-modal-header">
                <DialogTitle>{title}</DialogTitle>
              </div>
            )}
            {!title && <DialogTitle className="sr-only">弹窗</DialogTitle>}
            <DialogDescription className="sr-only">弹窗内容</DialogDescription>
            <div className="ui-modal-body" data-slot="c-modal-body" style={styles?.body}>
              {children}
            </div>
            {footer !== null && (footer || onOk) && (
              <div className="ui-modal-foot">
                {footer ?? (
                  <>
                    <button
                      type="button"
                      className="ui-action is-ghost"
                      onClick={onCancel}
                      disabled={cancelDisabled}
                    >
                      {cancelText}
                    </button>
                    <button
                      type="button"
                      className={cn('ui-action', confirmState?.danger ? 'is-danger' : 'is-primary')}
                      onClick={onOk}
                      disabled={okDisabled}
                    >
                      {okText}
                    </button>
                  </>
                )}
              </div>
            )}
            {closable && closeIcon !== null && (
              <DialogPrimitive.Close className="ui-modal-close" aria-label="关闭">
                {closeIcon ?? '×'}
              </DialogPrimitive.Close>
            )}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </Dialog>
  );
}
