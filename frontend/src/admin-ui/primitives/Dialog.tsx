import type { ReactNode } from 'react';
import { Dialog, Heading, Modal, ModalOverlay } from 'react-aria-components';
import { X } from 'lucide-react';
import { IconButton } from '../../vendor/boardui/components/base/buttons/icon-button';

/**
 * 居中弹窗（只读内容 / 短表单）。
 *
 * 与 `Drawer` 的分工：抽屉用来「从列表进入一条记录的完整上下文」，弹窗用来
 * 「不离开当前页快速看完一段内容」——法务原文预览、批量结果摘要都属于后者。
 * 需要并排对照列表的操作一律用抽屉，弹窗会挡住背后的行。
 *
 * 焦点锁定、Esc 关闭、遮罩点击关闭、关闭后焦点回到触发元素都由 React Aria 负责。
 */
export function ModalDialog({
  open,
  onOpenChange,
  title,
  description,
  width = 720,
  footer,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  width?: number;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <ModalOverlay
      isOpen={open}
      onOpenChange={onOpenChange}
      isDismissable
      className="bui-scope fixed inset-0 z-[1000] flex items-center justify-center bg-neutral-950/35 p-6"
    >
      <Modal className="max-h-[calc(100vh-48px)] w-[min(var(--dialog-width),100%)] outline-none" style={{ ['--dialog-width' as string]: `${width}px` }}>
        <Dialog
          data-testid="admin-modal"
          className="flex max-h-[calc(100vh-48px)] flex-col rounded-xl border border-border-table bg-white shadow-2xl outline-none"
        >
          <header className="flex items-start gap-3 border-b border-border-table px-5 py-3.5">
            <div className="min-w-0 flex-1">
              <Heading slot="title" className="truncate text-base font-semibold text-text-primary">
                {title}
              </Heading>
              {description && <p className="mt-0.5 text-xs text-text-tertiary">{description}</p>}
            </div>
            <IconButton
              icon={X}
              size="small"
              aria-label="关闭"
              className="border-0 bg-transparent shadow-none"
              onClick={() => onOpenChange(false)}
            />
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>

          {footer && (
            <footer className="flex items-center justify-end gap-2 border-t border-border-table bg-background-secondary-default px-5 py-3">
              {footer}
            </footer>
          )}
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
