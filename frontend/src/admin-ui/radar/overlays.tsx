import { Fragment, type ComponentType, type ReactNode } from 'react';
import { AlertTriangle, MoreHorizontal } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../components/ui/alert-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu';
import { cn } from '../lib/cn';
import { Button } from './Button';

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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="admin-modal"
        style={{ maxWidth: resolvedWidth }}
        className="radar-pop-enter flex max-h-[calc(100dvh-48px)] flex-col gap-0 overflow-hidden rounded-[12px] border border-radar-ink-200 bg-radar-surface p-0 shadow-none"
      >
        <DialogHeader className="shrink-0 border-b border-radar-ink-100 px-5 py-3.5">
          <DialogTitle className="truncate pr-12 text-[15px] font-semibold text-radar-ink-950">
            {title}
          </DialogTitle>
          {description && (
            <DialogDescription className="mt-0.5 text-pretty text-[12.5px] leading-5 text-radar-ink-400">
              {description}
            </DialogDescription>
          )}
        </DialogHeader>
        <div
          data-testid="admin-modal-body"
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4"
        >
          {children}
        </div>
        {footer && (
          <DialogFooter className="shrink-0 border-t border-radar-ink-100 bg-radar-surface-hover px-5 py-3">
            {footer}
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
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
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !loading) onCancel();
      }}
    >
      <AlertDialogContent
        data-testid="admin-confirm-action"
        className="radar-pop-enter w-[calc(100%-2rem)] max-w-[520px] gap-0 overflow-hidden rounded-[12px] border border-radar-ink-200 bg-radar-surface p-0 shadow-none sm:max-w-[520px]"
      >
        <AlertDialogHeader className="px-5 py-4 text-left">
          <AlertDialogTitle className="flex items-center gap-1.5 text-[15px] font-semibold text-radar-ink-950">
            {danger && <AlertTriangle className="size-4 shrink-0 text-radar-alert" aria-hidden />}
            {title}
          </AlertDialogTitle>
          {description && (
            <AlertDialogDescription asChild>
              <div className="space-y-1 text-[13px] leading-6 text-radar-ink-500">{description}</div>
            </AlertDialogDescription>
          )}
        </AlertDialogHeader>

        {(impact?.length || extra) && (
          <div
            data-testid="admin-confirm-action-body"
            className="flex flex-col gap-3 border-y border-radar-ink-100 bg-radar-surface-hover px-5 py-4"
          >
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
          </div>
        )}

        <AlertDialogFooter className="border-t border-radar-ink-100 bg-radar-surface-hover px-5 py-3">
          <AlertDialogCancel size="sm" disabled={loading} onClick={onCancel}>
            取消
          </AlertDialogCancel>
          <AlertDialogAction
            size="sm"
            onClick={(event) => {
              event.preventDefault();
              onConfirm();
            }}
            className={cn(
              'bg-radar-brand text-white hover:bg-radar-brand-hover',
              danger && 'bg-radar-alert text-white hover:bg-red-700',
              (loading || confirmDisabled) && 'pointer-events-none opacity-60',
            )}
          >
            {confirmText}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
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
        className="radar-pop-enter w-40 rounded-[8px] border border-radar-ink-200 bg-radar-surface p-1 shadow-none"
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

/* 兼容：部分页面直接引用带 icon 的确认动作按钮形态 */
export function ConfirmActionButton({
  icon: Icon,
  children,
  onClick,
  disabled,
  className,
}: {
  icon?: ComponentType<{ className?: string }>;
  children?: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <Button variant="secondary" size="sm" disabled={disabled} onClick={onClick} className={className}>
      {Icon ? <Icon className="size-4" aria-hidden /> : null}
      {children}
    </Button>
  );
}
