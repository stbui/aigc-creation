import { useEffect, useRef, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';

import { cn } from '../../lib/cn';
import { Button } from './controls';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '../../components/ui';

/**
 * 浮层（shadcn 版），与 `admin-ui/primitives` 的 `ModalDialog` / `Drawer`
 * 和 `AdminChrome` 的 `ConfirmAction` 同签名。
 *
 * - `ModalDialog` / `Drawer` 走 radix 的 portal：焦点锁定、Esc 关闭、遮罩点击
 *   关闭、关闭后焦点回到触发元素都由 radix 负责。这里只决定形态：
 *   - `ModalDialog` —— 居中弹窗，用来「不离开当前页看完一段内容」（上游导入结果、调价）；
 *   - `Drawer` —— 右侧抽屉，用来「从列表进入一条记录的完整上下文」（渠道新建 / 编辑）。
 * - `ConfirmAction` **不是弹层**，而是贴在页面底部的操作条 —— 产品明确要求
 *   高危动作不要弹阻塞层，运营要能一边看被影响的行一边确认后果。
 */

/* ────────────────────────── 居中弹窗 ────────────────────────── */

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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="admin-modal"
        style={{ maxWidth: width }}
        className="max-h-[calc(100vh-48px)] gap-0 overflow-hidden p-0"
      >
        <DialogHeader className="border-b border-border px-5 py-3.5 pr-12">
          <DialogTitle className="truncate text-base">{title}</DialogTitle>
          {description && (
            <DialogDescription className="text-xs">{description}</DialogDescription>
          )}
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>

        {footer && (
          <DialogFooter className="border-t border-border bg-muted/40 px-5 py-3">
            {footer}
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ────────────────────────── 右侧抽屉 ────────────────────────── */

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
  /** 面板宽度（桌面为主；窄屏自动收成满宽） */
  width?: number;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        data-testid="admin-drawer"
        side="right"
        style={{ width }}
        className="flex w-full flex-col gap-0 p-0 sm:max-w-none"
      >
        <SheetHeader className="border-b border-border px-5 py-4 pr-12">
          <SheetTitle className="truncate text-base">{title}</SheetTitle>
          {description && (
            <p className="truncate text-xs text-muted-foreground">{description}</p>
          )}
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>

        {footer && (
          <SheetFooter className="border-t border-border bg-muted/40 px-5 py-3 sm:flex-row sm:justify-end">
            {footer}
          </SheetFooter>
        )}
      </SheetContent>
    </Sheet>
  );
}

/* ────────────────────────── 二次确认 ────────────────────────── */

/**
 * 破坏性动作确认。
 *
 * `impact` 逐条列出「这一下会连带发生什么」—— 渠道删除会连带渠道模型与
 * 价格档，运营在确认前必须看到这条。没有影响清单的危险动作确认，用户只能
 * 凭按钮文字猜后果。
 */
export function ConfirmAction({
  open,
  title,
  description,
  impact,
  danger = false,
  confirmText = '确认',
  loading = false,
  confirmDisabled = false,
  extra,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description?: ReactNode;
  impact?: string[];
  danger?: boolean;
  /** @deprecated 不再要求输入确认词，保留入参仅为兼容旧调用 */
  requireTyping?: boolean;
  /** @deprecated 同上 */
  typingText?: string;
  confirmText?: string;
  loading?: boolean;
  confirmDisabled?: boolean;
  extra?: ReactNode;
  onCancel: () => void;
  onConfirm: (typed: string) => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  /*
   * 打开时把焦点移到操作条本身，Esc 关闭。
   *
   * 这是**页面内的操作条**而不是弹窗 —— 产品明确要求高危动作不要弹出阻塞层：
   * 运营需要一边看被影响的那几行，一边确认后果。所以这里不做遮罩、不锁焦点，
   * 只把键盘用户送进这块区域。
   */
  useEffect(() => {
    if (!open) return;
    panelRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !loading) onCancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [loading, onCancel, open]);

  if (!open) return null;

  return (
    <div
      ref={panelRef}
      role="region"
      aria-label={title}
      data-testid="admin-confirm-action"
      tabIndex={-1}
      className={cn(
        'sticky bottom-0 z-10 mt-3 overflow-hidden rounded-xl border bg-card shadow-lg outline-none',
        danger ? 'border-destructive/40' : 'border-border',
      )}
    >
      <div className="flex items-start gap-2 border-b border-border px-4 py-2.5">
        <div className="min-w-0 flex-1">
          <div
            className={cn(
              'flex items-center gap-1.5 text-sm font-semibold',
              danger ? 'text-danger-text' : 'text-foreground',
            )}
          >
            {danger && <AlertTriangle className="size-4 shrink-0" aria-hidden />}
            {title}
          </div>
          {description && <div className="mt-0.5 text-xs text-muted-foreground">{description}</div>}
        </div>
        <Button variant="ghost" size="small" onClick={onCancel} disabled={loading}>
          关闭
        </Button>
      </div>

      {(impact?.length || extra) && (
        <div className="flex flex-col gap-2 px-4 py-3">
          {impact && impact.length > 0 && (
            <div
              className={cn(
                'rounded-lg border px-3 py-2 text-xs leading-5',
                danger
                  ? 'border-danger-soft bg-danger-soft text-danger-text'
                  : 'border-warn-soft bg-warn-soft text-warn-text',
              )}
            >
              <div className="font-medium">影响范围</div>
              <ul className="mt-1 list-disc pl-4">
                {impact.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          )}
          {extra}
        </div>
      )}

      <div className="flex items-center justify-end gap-2 border-t border-border bg-muted/40 px-4 py-2.5">
        <Button variant="secondary" size="small" onClick={onCancel} disabled={loading}>
          取消
        </Button>
        <Button
          variant={danger ? 'danger' : 'primary'}
          size="small"
          disabled={loading || confirmDisabled}
          onClick={() => onConfirm('')}
        >
          {confirmText}
        </Button>
      </div>
    </div>
  );
}
