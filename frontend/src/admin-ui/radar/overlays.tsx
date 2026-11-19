import { Fragment, type ReactNode } from 'react';
import { AlertTriangle, MoreHorizontal, XIcon } from 'lucide-react';
import { AlertDialog as AlertDialogPrimitive, Dialog as DialogPrimitive } from 'radix-ui';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu';
import { cn } from '../lib/cn';
import { buttonClass } from './Button';

/* ────────────────────────── 居中弹窗 ────────────────────────── */

export const MODAL_WIDTH = { sm: 520, md: 720, lg: 960, xl: 1200 } as const;
export type ModalSize = keyof typeof MODAL_WIDTH;

export function ModalDialog({
  open,
  onOpenChange,
  title,
  description,
  size = 'md',
  width,
  footer,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  size?: ModalSize;
  width?: number;
  footer?: ReactNode;
  children: ReactNode;
}) {
  const resolvedWidth = width ?? MODAL_WIDTH[size];
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          data-slot="dialog-overlay"
          className="radar-backdrop-enter fixed inset-0 z-50 bg-radar-ink-950/25 backdrop-blur-[1px]"
        />
        <DialogPrimitive.Content
          data-testid="admin-modal"
          data-slot="dialog-content"
          style={{ maxWidth: resolvedWidth }}
          className="admin-portal radar-scope radar-pop-enter fixed left-1/2 top-1/2 z-50 flex max-h-[calc(100dvh-48px)] w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col gap-0 overflow-hidden rounded-[12px] border border-radar-ink-200 bg-radar-surface p-0 shadow-none outline-none"
        >
          <div className="flex shrink-0 items-start justify-between gap-3 border-b border-radar-ink-100 px-5 py-3.5">
            <div className="min-w-0">
              <DialogPrimitive.Title className="truncate text-[15px] font-semibold text-radar-ink-950">
                {title}
              </DialogPrimitive.Title>
              {description && (
                <DialogPrimitive.Description className="mt-0.5 text-pretty text-[12.5px] leading-5 text-radar-ink-400">
                  {description}
                </DialogPrimitive.Description>
              )}
            </div>
            <DialogPrimitive.Close
              aria-label="关闭"
              className="shrink-0 rounded-lg p-1.5 text-radar-ink-500 transition-colors hover:bg-radar-ink-100 hover:text-radar-ink-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-radar-accent"
            >
              <XIcon className="size-4" aria-hidden />
            </DialogPrimitive.Close>
          </div>
          <div
            data-testid="admin-modal-body"
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4"
          >
            {children}
          </div>
          {footer && (
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-radar-ink-100 bg-radar-surface-hover px-5 py-3">
              {footer}
            </div>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/* ────────────────────────── 破坏性动作确认 ────────────────────────── */

export function ConfirmDialog({
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
  confirmText?: string;
  loading?: boolean;
  confirmDisabled?: boolean;
  extra?: ReactNode;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const body =
    impact?.length || extra ? (
      <>
        {impact && impact.length > 0 && (
          <div
            className={cn(
              'rounded-[8px] border px-3 py-2 text-[12px] leading-5',
              danger
                ? 'border-radar-alert-border bg-radar-alert-subtle text-radar-alert'
                : 'border-radar-code-border bg-radar-code-subtle text-radar-code',
            )}
          >
            <div className="font-medium">影响范围</div>
            <ul className="mt-0.5 list-disc pl-4">
              {impact.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        )}
        {extra}
      </>
    ) : undefined;

  return (
    <AlertDialogPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        if (!next && !loading) onCancel();
      }}
    >
      <AlertDialogPrimitive.Portal>
        <AlertDialogPrimitive.Overlay
          data-slot="alert-dialog-overlay"
          className="radar-backdrop-enter fixed inset-0 z-50 bg-radar-ink-950/25 backdrop-blur-[1px]"
        />
        <AlertDialogPrimitive.Content
          data-testid="admin-confirm-action"
          data-slot="alert-dialog-content"
          className="admin-portal radar-scope radar-pop-enter fixed left-1/2 top-1/2 z-50 flex max-h-[calc(100dvh-48px)] w-[calc(100%-2rem)] max-w-[520px] -translate-x-1/2 -translate-y-1/2 flex-col gap-0 overflow-hidden rounded-[12px] border border-radar-ink-200 bg-radar-surface p-0 shadow-none outline-none"
        >
          <div className="px-5 py-4 text-left">
            <AlertDialogPrimitive.Title className="flex items-center gap-1.5 text-[15px] font-semibold text-radar-ink-950">
              {danger && <AlertTriangle className="size-4 shrink-0 text-radar-alert" aria-hidden />}
              {title}
            </AlertDialogPrimitive.Title>
            {description && (
              <AlertDialogPrimitive.Description asChild>
                <div className="mt-0.5 flex flex-col gap-1 text-[12.5px] leading-5 text-radar-ink-500">
                  {description}
                </div>
              </AlertDialogPrimitive.Description>
            )}
          </div>

          {body && (
            <div
              data-testid="admin-confirm-action-body"
              className="flex flex-col gap-3 border-t border-radar-ink-100 bg-radar-surface-hover px-5 py-4"
            >
              {body}
            </div>
          )}

          <div className="flex shrink-0 flex-row items-center justify-end gap-2 border-t border-radar-ink-100 bg-radar-surface-hover px-5 py-3">
            <AlertDialogPrimitive.Cancel
              className={buttonClass({ variant: 'secondary', size: 'sm' })}
              disabled={loading}
            >
              取消
            </AlertDialogPrimitive.Cancel>
            <AlertDialogPrimitive.Action
              className={buttonClass({
                variant: danger ? 'destructive' : 'default',
                size: 'sm',
              })}
              disabled={loading || confirmDisabled}
              onClick={(event) => {
                // 请求结束后再由父级关闭，避免加载期间弹框提前消失。
                event.preventDefault();
                onConfirm();
              }}
            >
              {confirmText}
            </AlertDialogPrimitive.Action>
          </div>
        </AlertDialogPrimitive.Content>
      </AlertDialogPrimitive.Portal>
    </AlertDialogPrimitive.Root>
  );
}

/* ────────────────────────── 行内更多菜单 ────────────────────────── */

export interface RowMenuItem {
  key: string;
  label: string;
  danger?: boolean;
  disabled?: boolean;
  separator?: boolean;
  onSelect: () => void;
}

export function RowMenu({ items, label = '更多' }: { items: RowMenuItem[]; label?: string }) {
  if (items.length === 0) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={label}
          title={label}
          className="inline-flex size-8 items-center justify-center rounded-lg text-radar-ink-400 transition-colors hover:bg-radar-ink-100 hover:text-radar-ink-900"
        >
          <MoreHorizontal className="size-4" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="admin-portal radar-scope radar-pop-enter w-40 rounded-[8px] border border-radar-ink-200 bg-radar-surface p-1 shadow-none"
        aria-label="更多操作"
        aria-labelledby={undefined}
        onClick={(event) => event.stopPropagation()}
      >
        <DropdownMenuGroup>
          {items.map((item) => (
            <Fragment key={item.key}>
              {item.separator && <DropdownMenuSeparator className="bg-radar-ink-100" />}
              <DropdownMenuItem
                disabled={item.disabled}
                onSelect={item.onSelect}
                className={cn(
                  'rounded-[6px] px-2 py-1.5 text-[13px] text-radar-ink-700 focus:bg-radar-surface-hover',
                  item.danger && 'text-radar-alert focus:bg-radar-alert-subtle',
                )}
              >
                {item.label}
              </DropdownMenuItem>
            </Fragment>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
