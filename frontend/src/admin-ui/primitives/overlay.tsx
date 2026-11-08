import { Fragment, type ReactNode } from 'react';
import { AlertTriangle, MoreHorizontal } from 'lucide-react';

import { cn } from '../lib/cn';
import { Button } from '../components/ui/button';
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '../components/ui/sheet';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu';

/**
 * 后台浮层：居中弹窗 / 右侧抽屉 / 破坏性动作确认。
 *
 * ## 两种浮层怎么选
 *
 * - `ModalDialog` —— 居中弹窗，用来「不离开当前页看完一段内容」（导入结果、调价预览）。
 * - `Drawer` —— 右侧抽屉，用来「从列表进入一条记录的完整上下文」（详情、编辑）。
 *
 * 焦点锁定、Esc 关闭、遮罩点击、关闭后焦点归位都由 radix 负责，这里只决定形态。
 *
 * ## 破坏性动作确认用 shadcn AlertDialog
 *
 * `ConfirmDialog` 只是 AlertDialog 的排版组合：标题 / 影响范围 / 附加表单 / 底部动作。
 * 弹层本身不手写 —— 焦点锁定、Esc、关闭后焦点归位都来自 radix；
 * 遮罩点击不关闭（AlertDialog 的默认语义）。
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
        className="admin-portal flex max-h-[calc(100dvh-48px)] flex-col gap-0 overflow-hidden p-0"
      >
        <DialogHeader className="shrink-0 border-b border-border px-5 py-3.5">
          <DialogTitle className="truncate pr-12 text-base">{title}</DialogTitle>
          {description && (
            <DialogDescription className="text-pretty text-xs leading-5">
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
          <DialogFooter className="shrink-0 border-t border-border bg-muted/40 px-5 py-3">
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
  width?: number;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        data-testid="admin-drawer"
        side="right"
        style={{ width, maxWidth: '100vw' }}
        className="admin-portal flex w-full flex-col gap-0 p-0 sm:max-w-none"
      >
        <SheetHeader className="border-b border-border px-5 py-4">
          <SheetTitle className="truncate pr-12 text-base">{title}</SheetTitle>
          {description && (
            <p className="text-pretty text-xs leading-5 text-muted-foreground">{description}</p>
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

/* ────────────────────────── 破坏性动作确认 ────────────────────────── */

/**
 * 破坏性动作确认。
 *
 * `impact` 逐条列出「这一下会连带发生什么」—— 删除渠道会连带渠道模型与价格档，
 * 运营在确认前必须看到。没有影响清单的危险确认，用户只能凭按钮文字猜后果。
 *
 * 弹层行为全部交给 shadcn AlertDialog：点击确认后不自动关闭，由调用方在请求
 * 成功后再收起，避免加载期间弹框提前消失。
 */
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
        className="admin-portal w-[calc(100%-2rem)] max-w-[520px] gap-0 overflow-hidden p-0 sm:max-w-[520px]"
      >
        <AlertDialogHeader className="px-5 py-4 text-left">
          <AlertDialogTitle className="flex items-center gap-1.5 text-base">
            {danger && <AlertTriangle className="size-4 shrink-0 text-danger-text" aria-hidden />}
            {title}
          </AlertDialogTitle>
          {description && (
            <AlertDialogDescription asChild>
              <div className="space-y-1 text-sm leading-6">{description}</div>
            </AlertDialogDescription>
          )}
        </AlertDialogHeader>

        {(impact?.length || extra) && (
          <div
            data-testid="admin-confirm-action-body"
            className="flex flex-col gap-3 border-y border-border bg-muted/30 px-5 py-4"
          >
            {impact && impact.length > 0 && (
              <div
                className={cn(
                  'rounded-md border px-3 py-2 text-xs leading-5',
                  danger
                    ? 'border-danger-soft bg-danger-soft text-danger-text'
                    : 'border-warn-soft bg-warn-soft text-warn-text',
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

        <AlertDialogFooter className="border-t border-border bg-muted/40 px-5 py-3">
          <AlertDialogCancel size="sm" disabled={loading}>
            取消
          </AlertDialogCancel>
          <AlertDialogAction
            size="sm"
            variant={danger ? 'destructive' : 'default'}
            disabled={loading || confirmDisabled}
            onClick={(event) => {
              // 请求结束后再由父级关闭，避免加载期间弹框提前消失。
              event.preventDefault();
              onConfirm();
            }}
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
  /** 分隔线前的项（如「删除用户」）由调用方把 `separator` 放在下一项上 */
  separator?: boolean;
  onSelect: () => void;
}

/**
 * 表格操作列的「更多」菜单。
 *
 * 操作列只直显最多两个动作，其余收进这里 —— 五个动作平铺会把行撑高，
 * 且在 1000px 宽的表里必然被右侧裁掉。受控关闭：选中一项后立刻收起，
 * 否则删完记录菜单还浮在空行上。
 *
 * 无可用动作时整个触发器不渲染 —— 一个点开是空的菜单比没有更糟。
 *
 * ## 弹层的可访问名
 *
 * radix 默认把菜单的可访问名取成触发器文字（「更多」），但同一页可能有多张表，
 * 每张表的菜单都叫「更多」没法区分。显式给 `aria-label` 并清掉
 * `aria-labelledby`，弹层统一叫「更多操作」—— 读屏与 e2e 都按这个名字取。
 */
export function RowMenu({ items, label = '更多' }: { items: RowMenuItem[]; label?: string }) {
  if (items.length === 0) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={label} title={label}>
          <MoreHorizontal className="size-4" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="admin-portal w-40"
        aria-label="更多操作"
        aria-labelledby={undefined}
      >
        <DropdownMenuGroup>
          {items.map((item) => (
            <Fragment key={item.key}>
              {item.separator && <DropdownMenuSeparator />}
              <DropdownMenuItem
                className={item.danger ? 'text-danger-text focus:text-danger-text' : undefined}
                disabled={item.disabled}
                onSelect={item.onSelect}
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
