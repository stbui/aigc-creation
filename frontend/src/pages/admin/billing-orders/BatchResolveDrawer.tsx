import { ActionButton, Drawer, Notice, TextAreaField } from './components';

interface BatchResolveDrawerProps {
  open: boolean;
  count: number;
  action: 'settle' | 'refund';
  onActionChange: (action: 'settle' | 'refund') => void;
  reason: string;
  onReasonChange: (reason: string) => void;
  busy: boolean;
  results: Array<{ id: string; ok: boolean; error?: string }> | null;
  onClose: () => void;
  onConfirm: () => void;
}

/**
 * 批量核对：逐条独立处置，单条失败不影响其余，结果逐条回显。
 */
export function BatchResolveDrawer({
  open,
  count,
  action,
  onActionChange,
  reason,
  onReasonChange,
  busy,
  results,
  onClose,
  onConfirm,
}: BatchResolveDrawerProps) {
  return (
    <Drawer
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      width={620}
      title="批量核对账单"
      description={`已选 ${count} 条。逐条独立处置，单条失败不影响其余。`}
      footer={
        <>
          <ActionButton variant="secondary" size="sm" onClick={onClose} disabled={busy}>
            关闭
          </ActionButton>
          <ActionButton
            variant="default"
            size="sm"
            disabled={busy || !reason.trim() || count === 0}
            onClick={onConfirm}
          >
            {busy ? '处理中…' : action === 'refund' ? '确认批量退款' : '确认批量结算'}
          </ActionButton>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex gap-2">
          <ActionButton
            variant={action === 'settle' ? 'default' : 'secondary'}
            size="sm"
            onClick={() => onActionChange('settle')}
          >
            按现有用量结算
          </ActionButton>
          <ActionButton
            variant={action === 'refund' ? 'destructive' : 'secondary'}
            size="sm"
            onClick={() => onActionChange('refund')}
          >
            全额退款
          </ActionButton>
        </div>
        <TextAreaField
          ariaLabel="批量核对依据"
          value={reason}
          onChange={onReasonChange}
          rows={3}
          placeholder="写明为什么这样处置；会写入审计与账单备注"
        />
        {results && (
          <Notice tone={results.some((item) => !item.ok) ? 'warn' : 'info'} title="处理结果">
            <ul className="flex flex-col gap-1 text-xs">
              {results.map((item) => (
                <li key={item.id} className="font-mono">
                  {item.ok ? '✓' : '✗'} {item.id}
                  {item.error ? ` — ${item.error}` : ''}
                </li>
              ))}
            </ul>
          </Notice>
        )}
      </div>
    </Drawer>
  );
}
