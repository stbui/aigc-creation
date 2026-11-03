import { ActionButton, Drawer, Notice } from '~/admin-ui/primitives';

interface BatchResolveDrawerProps {
  open: boolean;
  count: number;
  action: 'settle' | 'refund';
  onActionChange: (action: 'settle' | 'refund') => void;
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
            disabled={busy || count === 0}
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
