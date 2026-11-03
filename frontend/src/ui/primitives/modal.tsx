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
  centered?: boolean;
  closable?: boolean;
  maskClosable?: boolean;
  destroyOnHidden?: boolean;
  confirmLoading?: boolean;
  okButtonProps?: {
    danger?: boolean;
    disabled?: boolean;
    loading?: boolean;
    type?: 'primary' | 'default' | 'link' | 'text' | 'dashed';
  };
  cancelButtonProps?: { disabled?: boolean };
  className?: string;
  styles?: { body?: CSSProperties; mask?: CSSProperties; container?: CSSProperties };
  /** antd 6 兼容：`mask={{ closable }}` */
  mask?: { closable?: boolean };
  keyboard?: boolean;
  closeIcon?: ReactNode;
  afterClose?: () => void;
}

/**
 * antd Modal 的兼容壳。
 *
 * 标题与关闭按钮交给 radix Dialog；内容区沿用调用方已有的 className / styles，
 * 让 `.mum-modal`、`.login-modal` 等页面级样式仍然命中。
 *
 * ## ⚠️ 页面级类与容器类挂在**同一个元素**上
 *
 * `className` 不是加在某个外层 div, 而是与容器类合并进**一个** div:
 *
 *   <div class="ui-modal-surface ant-modal-container ant-modal-content {className}">
 *
 * 因此 global.css 里所有针对容器的页面级规则**必须写成紧邻合并选择器**:
 *
 *   ✅  .alp-modal.ant-modal-container { ... }
 *   ❌  .alp-modal .ant-modal-container { ... }   ← 后代形式恒不命中
 *
 * 写成后代形式不会报错, 只会静默失效 —— 表现为弹窗几何退回 `.ui-modal-surface`
 * 的默认值, 内部三段高度不受约束, 底部操作条被撑到文档流末端。
 * 素材库导入弹窗 (@2026-11-03) 与登录 / 手机上传弹窗都踩过这个坑,
 * 三处容器规则一度全是死规则。
 *
 * 另注: `.ant-modal` 这个节点**不存在** (容器是 `.ui-modal-content`),
 * 针对它的规则 (如 `.ant-modal.mum-modal`) 同样是死规则。
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
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onCancel?.()}>
      <DialogPrimitive.Portal>
        <DialogOverlay style={styles?.mask} />
        <DialogPrimitive.Content
          className="ui-modal-content"
          style={{ maxWidth: width }}
          onEscapeKeyDown={keyboard ? undefined : (event) => event.preventDefault()}
          onPointerDownOutside={canMaskClose ? undefined : (event) => event.preventDefault()}
          onOpenAutoFocus={
            title ? (event) => event.preventDefault() : undefined
          }
        >
          <div className={cn('ui-modal-surface ant-modal-container ant-modal-content', className)} style={styles?.container}>
            {title && (
              <div className="ui-modal-head ant-modal-header">
                <DialogTitle>{title}</DialogTitle>
              </div>
            )}
            {!title && <DialogTitle className="sr-only">弹窗</DialogTitle>}
            <DialogDescription className="sr-only">弹窗内容</DialogDescription>
            <div className="ui-modal-body ant-modal-body" style={styles?.body}>
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
