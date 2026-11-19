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
  /** 旧版 UI 库兼容：false 时按顶部定位，true（本项目既有默认）时垂直居中。 */
  centered?: boolean;
  /** Radix 默认在关闭时卸载内容；显式传 false 可保留 DOM 状态。 */
  destroyOnHidden?: boolean;
  closable?: boolean;
  maskClosable?: boolean;
  confirmLoading?: boolean;
  okButtonProps?: {
    danger?: boolean;
    disabled?: boolean;
    loading?: boolean;
  };
  cancelButtonProps?: { disabled?: boolean };
  className?: string;
  styles?: { body?: CSSProperties; mask?: CSSProperties; container?: CSSProperties };
  /** 旧版 UI 库兼容：`mask={{ closable }}` */
  mask?: { closable?: boolean };
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
  centered = true,
  destroyOnHidden,
  closable = true,
  mask,
  maskClosable,
  className,
  styles,
  keyboard = true,
  closeIcon,
  confirmLoading,
  okButtonProps,
  cancelButtonProps,
}: ModalProps) {
  const canMaskClose = maskClosable ?? mask?.closable ?? true;
  const okDisabled = Boolean(confirmLoading || okButtonProps?.loading || okButtonProps?.disabled);
  const keepMounted = destroyOnHidden === false;
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
          className={cn('ui-modal-content', centered ? 'is-centered' : 'is-top')}
          style={{
            maxWidth: width,
            ...(!centered ? { top: 100, transform: 'translateX(-50%)' } : {}),
          }}
          data-destroy-on-hidden={destroyOnHidden ?? true}
          onEscapeKeyDown={keyboard ? undefined : (event) => event.preventDefault()}
          onPointerDownOutside={canMaskClose ? undefined : (event) => event.preventDefault()}
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
                      className="ui-btn is-ghost"
                      onClick={onCancel}
                      disabled={cancelButtonProps?.disabled}
                    >
                      {cancelText}
                    </button>
                    <button
                      type="button"
                      className={cn('ui-btn', okButtonProps?.danger ? 'is-danger' : 'is-primary')}
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
