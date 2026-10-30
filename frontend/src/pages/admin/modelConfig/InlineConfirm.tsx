import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '../../../vendor/boardui/components/base/buttons/button';
import { TextArea } from '../../../admin-ui/controls';
import { cx } from '../../../admin-ui/lib/cn';

/**
 * 模型配置页的操作确认区（页面内，不使用弹窗）。
 *
 * 与后台通用 `ConfirmAction` 的差别只有一个：**需要填写变更原因**。
 * 模型配置是全站最容易配错的一处（地址填错 → 任务失败并退款；令牌写错 →
 * 整条线路不通），改动必须能事后回答「谁为什么改」，所以原因不是可选的
 * 说明文字，而是这块确认区自带的一个必填输入。
 *
 * 与 antd 时代的差别：不再要求「输入确认词」。阻塞式二次确认已按产品要求
 * 去掉，影响面照常展示，但不再让运营手打一遍线路名。
 */
export function InlineConfirm({
  open,
  title,
  description,
  impact,
  danger = false,
  confirmText = '确认',
  loading = false,
  needReason = false,
  reasonPlaceholder = '如：接入备用线路',
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
  needReason?: boolean;
  reasonPlaceholder?: string;
  onCancel: () => void;
  onConfirm: (typed: string, reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setReason('');
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
      tabIndex={-1}
      className={cx(
        'sticky bottom-0 z-10 mt-3 rounded-xl border bg-white shadow-lg outline-none',
        danger ? 'border-rose-300' : 'border-border-table',
      )}
    >
      <div className="flex items-start gap-2 border-b border-border-table px-4 py-2.5">
        <div className="min-w-0 flex-1">
          <div className={cx('text-sm font-semibold', danger ? 'text-rose-700' : 'text-text-primary')}>
            {title}
          </div>
          {description && <div className="mt-0.5 text-xs text-text-secondary">{description}</div>}
        </div>
        <Button variant="ghost" size="xs" onClick={onCancel} disabled={loading}>
          关闭
        </Button>
      </div>

      {(impact?.length || needReason) && (
        <div className="flex flex-col gap-2 px-4 py-3">
          {impact && impact.length > 0 && (
            <div
              className={cx(
                'rounded-lg border px-3 py-2 text-xs',
                danger ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-amber-200 bg-amber-50 text-amber-900',
              )}
            >
              <div className="font-medium">影响范围</div>
              <ul className="mt-1 list-disc pl-4">
                {impact.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          )}
          {needReason && (
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="mc-confirm-reason"
                className="text-xs font-medium text-text-secondary"
              >
                变更原因（建议填写，便于审计追溯）
              </label>
              <TextArea
                value={reason}
                onChange={setReason}
                placeholder={reasonPlaceholder}
                rows={2}
                maxLength={200}
                ariaLabel="变更原因"
              />
            </div>
          )}
        </div>
      )}

      <div className="flex items-center justify-end gap-2 border-t border-border-table px-4 py-2.5">
        <Button variant="secondary" size="small" onClick={onCancel} disabled={loading}>
          取消
        </Button>
        <Button
          variant={danger ? 'danger' : 'primary'}
          size="small"
          disabled={loading}
          onClick={() => onConfirm('', reason)}
        >
          {loading && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
          {confirmText}
        </Button>
      </div>
    </div>
  );
}
