import type { ComponentType, ReactNode } from 'react';
import { AlertTriangle, XIcon } from 'lucide-react';
import { AlertDialog as AlertDialogPrimitive } from 'radix-ui';
import { cn } from '../lib/cn';
import { buttonClass } from './Button';

/**
 * 高危动作确认的统一壳（Radar 视觉）。
 *
 * 五个调用方（删除用户、批量删除、禁用/启用、强制下线、变更角色）此前各手写
 * 一份 shadcn `AlertDialog` 骨架，标题字号、阴影、边线各自漂移。这里直接用
 * radix 原语拼装，固定：
 *
 * - 12px 圆角、1px `radar-ink-200` 描边、零阴影、遮罩 25% 灰；
 * - 标题 15px / 600，描述 12.5px / 20px；
 * - 影响面区域可滚动，矮视口不把底部按钮挤出屏幕；
 * - `loading` 期间不响应遮罩 / Esc 关闭，确认按钮不自动收起弹框，请求结束后
 *   由父级关闭，避免加载态闪退。
 */
export function ConfirmAlert({
  testId,
  title,
  description,
  icon: Icon = AlertTriangle,
  danger = true,
  body,
  bodyScroll = false,
  confirmText,
  confirmIcon: ConfirmIcon,
  loading = false,
  confirmDisabled = false,
  onCancel,
  onConfirm,
}: {
  testId: string;
  title: ReactNode;
  /** `AlertDialog.Description` 需要单个元素；传 `<p>` / `<div>` / 片段。 */
  description: ReactNode;
  icon?: ComponentType<{ className?: string }> | null;
  /** 标题与确认按钮使用告警红，并在标题前显示图标。 */
  danger?: boolean;
  /** 影响面 / 表单等正文区域；不传则只渲染标题、描述与按钮。 */
  body?: ReactNode;
  /** 影响面较长时限制高度并在区域内滚动。 */
  bodyScroll?: boolean;
  confirmText: string;
  confirmIcon?: ComponentType<{ className?: string }>;
  loading?: boolean;
  confirmDisabled?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <AlertDialogPrimitive.Root
      open
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
          data-testid={testId}
          data-slot="alert-dialog-content"
          className={cn(
            'admin-portal radar-scope radar-pop-enter fixed left-1/2 top-1/2 z-50 flex w-[calc(100%-2rem)] max-w-[520px]',
            '-translate-x-1/2 -translate-y-1/2 flex-col gap-0 overflow-hidden',
            'rounded-[12px] border border-radar-ink-200 bg-radar-surface p-0 shadow-none outline-none',
            bodyScroll && 'max-h-[calc(100dvh-2rem)]',
          )}
        >
          <div className="flex items-start justify-between gap-3 px-5 py-4 text-left">
            <div className="min-w-0">
              <AlertDialogPrimitive.Title className="flex items-center gap-2 text-[15px] font-semibold text-radar-ink-950">
                {Icon ? (
                  <Icon
                    className={cn(
                      'size-4 shrink-0',
                      danger ? 'text-radar-alert' : 'text-radar-ink-500',
                    )}
                    aria-hidden
                  />
                ) : null}
                {title}
              </AlertDialogPrimitive.Title>
              <AlertDialogPrimitive.Description asChild>
                <div className="mt-0.5 flex flex-col gap-1 text-[12.5px] leading-5 text-radar-ink-500">
                  {description}
                </div>
              </AlertDialogPrimitive.Description>
            </div>
            <AlertDialogPrimitive.Cancel
              aria-label="关闭"
              disabled={loading}
              className="shrink-0 rounded-lg p-1.5 text-radar-ink-500 transition-colors hover:bg-radar-ink-100 hover:text-radar-ink-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-radar-accent disabled:pointer-events-none disabled:opacity-50"
            >
              <XIcon className="size-4" aria-hidden />
            </AlertDialogPrimitive.Cancel>
          </div>

          {body ? (
            <div
              className={cn(
                'border-t border-radar-ink-100 bg-radar-surface-hover px-5 py-4',
                'text-[12px] leading-5 text-radar-ink-500',
                bodyScroll && 'min-h-0 flex-1 overflow-y-auto',
              )}
            >
              {body}
            </div>
          ) : null}

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
              {ConfirmIcon ? <ConfirmIcon className="size-3.5" aria-hidden /> : null}
              {confirmText}
            </AlertDialogPrimitive.Action>
          </div>
        </AlertDialogPrimitive.Content>
      </AlertDialogPrimitive.Portal>
    </AlertDialogPrimitive.Root>
  );
}
