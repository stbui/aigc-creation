import {
  ActionButton,
  Descriptions,
  Drawer,
  Notice,
  TextAreaField,
} from './components';
import { BILLING_MODE_LABELS, REFUND_REASON_LABELS, STATUS_LABELS } from './constants';
import { canResolveStatus, formatTime, toCredits, toCreditsInput } from './utils';
import type { BillingOrderView } from '../../../types/model';

interface BillingDetailDrawerProps {
  open: boolean;
  detail: BillingOrderView | null;
  resolvable: boolean;
  action: 'settle' | 'refund';
  onActionChange: (action: 'settle' | 'refund') => void;
  reason: string;
  onReasonChange: (reason: string) => void;
  resolving: boolean;
  onClose: () => void;
  onResolve: () => void;
}

/**
 * 账单详情与人工核对。
 *
 * 金额全部是只读快照：核对只选「按现有用量结算」或「全额退款」，
 * 页面不提供改金额的入口。
 */
export function BillingDetailDrawer({
  open,
  detail,
  resolvable,
  action,
  onActionChange,
  reason,
  onReasonChange,
  resolving,
  onClose,
  onResolve,
}: BillingDetailDrawerProps) {
  const canResolve = Boolean(detail && resolvable && canResolveStatus(detail.status));

  return (
    <Drawer
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      width={720}
      title="账单详情"
      description={detail ? `${STATUS_LABELS[detail.status] ?? detail.status} · ${detail.id}` : undefined}
      footer={
        <>
          <ActionButton variant="secondary" size="sm" onClick={onClose} disabled={resolving}>
            关闭
          </ActionButton>
          {canResolve && (
            <ActionButton
              variant="default"
              size="sm"
              disabled={resolving || !reason.trim()}
              onClick={onResolve}
            >
              {resolving ? '处理中…' : action === 'refund' ? '确认退款' : '确认结算'}
            </ActionButton>
          )}
        </>
      }
    >
      {detail ? (
        <div className="flex flex-col gap-4">
          <Descriptions
            items={[
              { label: '状态', value: STATUS_LABELS[detail.status] ?? detail.status },
              { label: '用户', value: `${detail.userEmail || '—'}（${detail.userId}）` },
              { label: '任务', value: <span className="font-mono text-xs">{detail.taskId || '—'}</span> },
              { label: '前台模型', value: detail.model || '—' },
              { label: '能力 / 场景', value: `${detail.capability}${detail.scene ? ` · ${detail.scene}` : ''}` },
              { label: '用户分组', value: detail.userGroup || 'default' },
              { label: '渠道', value: `${detail.channelName || '—'}（${detail.channelId || '—'}）` },
              { label: '渠道模型', value: detail.channelModelName || detail.channelModelId || '—' },
              { label: '价格档', value: detail.priceTierId || '—' },
              {
                label: '计费方式',
                value: `${BILLING_MODE_LABELS[detail.billingMode] ?? detail.billingMode} · 数量 ${detail.quantity}`,
              },
              { label: '单价', value: `${toCreditsInput(detail.unitPriceMicrocredits)} 积分` },
              { label: '倍率', value: `${detail.multiplierBasisPoints / 100}%` },
              { label: '预留金额', value: `${toCredits(detail.reservedAmountMicrocredits)} 积分` },
              { label: '实际金额', value: `${toCredits(detail.actualAmountMicrocredits)} 积分` },
              { label: '已退金额', value: `${toCredits(detail.refundedAmountMicrocredits)} 积分` },
              {
                label: '退款归类',
                value: detail.refundReason
                  ? (REFUND_REASON_LABELS[detail.refundReason] ?? detail.refundReason)
                  : '—',
              },
              {
                label: '成本',
                value: detail.costConfigured
                  ? `${toCredits(detail.costAmountMicrocredits)} 积分`
                  : '未配置成本价',
              },
              {
                label: 'Token 用量',
                value: detail.usageAvailable
                  ? `输入 ${detail.inputTokens} · 输出 ${detail.outputTokens} · 缓存 ${detail.cachedTokens}（${detail.usageSource}）`
                  : '无用量数据',
              },
              { label: '开始 / 结算', value: `${formatTime(detail.startedAt)} / ${formatTime(detail.settledAt)}` },
              { label: '退款时间', value: formatTime(detail.refundedAt) },
              { label: '上游请求号', value: <span className="font-mono text-xs">{detail.providerRequestId || '—'}</span> },
            ]}
            columns={2}
          />

          {detail.errorText && (
            <Notice tone="danger" title="失败原因">
              {detail.errorText}
            </Notice>
          )}
          {detail.resolutionNote && (
            <Notice tone="info" title="人工核对记录">
              {detail.resolutionNote}
              {detail.resolvedBy ? `（操作人 ${detail.resolvedBy}）` : ''}
            </Notice>
          )}

          {canResolve && (
            <div className="rounded-lg border border-border p-3">
              <div className="mb-2 text-xs font-semibold text-foreground">人工核对</div>
              <div className="mb-2 flex gap-2">
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
                ariaLabel="核对依据"
                value={reason}
                onChange={onReasonChange}
                rows={3}
                maxLength={200}
                placeholder="写清核对依据，如：上游确认出图成功但回调丢失"
              />
              {action === 'refund' && (
                <p className="mt-1 text-[12px] text-danger-text">
                  退款会按预留金额原额退回用户积分，且不可撤销。
                </p>
              )}
            </div>
          )}
        </div>
      ) : (
        <p className="py-6 text-center text-xs text-muted-foreground">
          该账单不在当前页。请回到列表按任务 ID 或用户 ID 定位。
        </p>
      )}
    </Drawer>
  );
}
