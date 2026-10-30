import type { ReactNode } from 'react';
import { Dialog, Heading, Modal, ModalOverlay } from 'react-aria-components';
import { X } from 'lucide-react';
import { IconButton } from '../../vendor/boardui/components/base/buttons/icon-button';
import { cx } from '../lib/cn';

/**
 * 详情抽屉。
 *
 * 后台 13 处详情页原先都用 antd `Drawer`。BoardUI 免费层没有通用抽屉，
 * 这里用 React Aria 的 Modal/Dialog 补齐：焦点锁定、Esc 关闭、遮罩点击关闭、
 * 回到触发元素恢复焦点都由 React Aria 负责，不自己造轮子。
 *
 * 结构固定为「标题栏 + 可滚动正文 + 固定操作区」——详情页的操作按钮必须
 * 始终可见，不能跟着长内容滚出屏幕。
 */
export function Drawer({
  open,
  onOpenChange,
  title,
  description,
  width = 520,
  footer,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  /** 面板宽度，桌面端为主；窄屏自动收成满宽 */
  width?: number;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <ModalOverlay
      isOpen={open}
      onOpenChange={onOpenChange}
      isDismissable
      className="bui-scope fixed inset-0 z-[1000] bg-neutral-950/35"
    >
      <Modal className="fixed inset-y-0 right-0 flex outline-none">
        <Dialog
          className={cx(
            'flex h-full w-[min(var(--drawer-width),100vw)] flex-col bg-white shadow-2xl outline-none',
            'border-l border-border-table',
          )}
          style={{ ['--drawer-width' as string]: `${width}px` }}
        >
          <header className="flex items-start gap-3 border-b border-border-table px-5 py-4">
            <div className="min-w-0 flex-1">
              <Heading slot="title" className="truncate text-base font-semibold text-text-primary">
                {title}
              </Heading>
              {description && (
                <p className="mt-0.5 truncate text-xs text-text-tertiary">{description}</p>
              )}
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
