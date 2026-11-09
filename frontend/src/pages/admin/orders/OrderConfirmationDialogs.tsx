import { Link } from 'react-router-dom';
import { ConfirmDialog, TextField } from '~/admin-ui/primitives';
import { yuan } from './utils';
import type { AdminOrderRefund, AdminOrderRow } from '../../../types/api';

/**
 * 退款规则入口（后台「系统设置 → 退款」分组深链）。
 *
 * 退款被规则拒绝时（时间窗 / 比例上限 / 已消耗积分），运营要改的是规则本身。
 * 弹窗里直接给这个入口，省掉「先关弹窗、进设置、在八个页签里找『退款』」。
 */
export const REFUND_RULES_HREF = '/admin/settings?group=refund';

export type RefundConfirmationTarget = {
  orderId: string;
  refund: AdminOrderRefund;
  outcome: 'succeeded' | 'failed';
};

export function OrderActionDialog({
  action,
  refundYuan,
  refundReason,
  loading,
  onRefundYuanChange,
  onRefundReasonChange,
  onCancel,
  onConfirm,
}: {
  action: { kind: 'markPaid' | 'refund'; row: AdminOrderRow } | null;
  refundYuan: string;
  refundReason: string;
  loading: boolean;
  onRefundYuanChange: (value: string) => void;
  onRefundReasonChange: (value: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!action) return null;
  return (
    <ConfirmDialog
      open
      title={action.kind === 'markPaid' ? '手工核销订单' : '订单退款'}
      confirmText={action.kind === 'markPaid' ? '确认已收款' : '确认退款'}
      danger={action.kind === 'refund'}
      loading={loading}
      onCancel={onCancel}
      onConfirm={onConfirm}
      description={
        action.kind === 'markPaid' ? (
          <>
            <p>
              将先生成一条 <b>channel=manual</b> 的支付流水，再把订单置为已支付并发放积分/会员权益。
            </p>
            <p className="text-[12px] text-muted-foreground">
              订单 {action.row.orderNo} · ¥ {yuan(action.row.paidCents)} ·{' '}
              {action.row.membershipPlanName ?? `${action.row.itemCount} 件商品`}
            </p>
          </>
        ) : (
          <>
            <p>
              退款会回收本单发放且<b>尚未被消耗</b>的积分；已被用掉的部分无法扣回，结果会如实提示。
            </p>
            <p className="text-[12px] text-muted-foreground">
              订单 {action.row.orderNo} · 实付 ¥ {yuan(action.row.paidCents)} · 已退 ¥{' '}
              {yuan(action.row.refundedCents)} · 可退上限 ¥{' '}
              {yuan(Math.max(action.row.paidCents - action.row.refundedCents, 0))}
            </p>
          </>
        )
      }
      impact={
        action.kind === 'markPaid'
          ? [
              '订单状态 → 已支付',
              `发放 ${action.row.grantedCredits > 0 ? action.row.grantedCredits : '（按商品配置）'} 积分`,
              action.row.membershipPlanName
                ? `激活会员：${action.row.membershipPlanName}`
                : '不涉及会员',
              '写操作审计（含操作人）',
            ]
          : [
              `退款金额 ¥ ${refundYuan || '未填'}`,
              '回收未消耗的积分（按批次剩余量）',
              '订单状态 → 已退款 / 部分退款',
              '写操作审计（含操作人）',
            ]
      }
      extra={
        action.kind === 'refund' ? (
          <>
            <div className="flex flex-col gap-1.5">
              <span className="text-xs text-muted-foreground">退款金额（元）</span>
              <TextField
                ariaLabel="退款金额"
                inputMode="decimal"
                value={refundYuan}
                onChange={onRefundYuanChange}
                placeholder="0.00"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-xs text-muted-foreground">退款原因</span>
              <TextField
                ariaLabel="退款原因"
                value={refundReason}
                onChange={onRefundReasonChange}
                placeholder="如：用户申请退款，已核实订单"
                maxLength={200}
              />
            </div>
            {/*
             * 退款规则入口：时间窗 / 比例上限 / 已消耗积分三条规则在后台
             * 可配，被拒时运营要改的是规则而不是金额。直接把入口摆在弹窗里。
             */}
            <p className="text-[12px] leading-5 text-muted-foreground">
              退款受
              <Link
                to={REFUND_RULES_HREF}
                className="mx-0.5 text-brand hover:underline"
                target="_blank"
                rel="noreferrer"
              >
                退款规则
              </Link>
              约束（可退时间窗 / 比例上限 / 已消耗积分）。超出规则时会在提示里说明该调哪一条。
            </p>
          </>
        ) : undefined
      }
    />
  );
}

export function RefundConfirmationDialog({
  confirmation,
  reason,
  providerRefundId,
  loading,
  onReasonChange,
  onProviderRefundIdChange,
  onCancel,
  onConfirm,
}: {
  confirmation: RefundConfirmationTarget | null;
  reason: string;
  providerRefundId: string;
  loading: boolean;
  onReasonChange: (value: string) => void;
  onProviderRefundIdChange: (value: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!confirmation) return null;
  const succeeded = confirmation.outcome === 'succeeded';
  return (
    <ConfirmDialog
      open
      title={succeeded ? '确认渠道已退款' : '确认退款失败'}
      confirmText={succeeded ? '确认已退款' : '确认失败并关闭'}
      danger
      loading={loading}
      confirmDisabled={!reason.trim()}
      onCancel={onCancel}
      onConfirm={onConfirm}
      description={
        succeeded ? (
          <>
            <p>
              仅在渠道商户后台核实资金<b>已原路退回</b>后确认。系统会把退款单置为成功，
              并在同一事务内扣回未消耗积分、更新订单退款金额与状态。
            </p>
            <p className="text-[12px] text-muted-foreground">
              退款单 {confirmation.refund.id} · 订单 {confirmation.orderId} · ¥{' '}
              {yuan(confirmation.refund.amountCents)}
            </p>
          </>
        ) : (
          <>
            <p>
              仅在渠道商户后台核实<b>退款未成功</b>后确认。此动作只关闭这笔退款单并保留证据，
              <b>不修改订单状态，也不扣回积分</b>。
            </p>
            <p className="text-[12px] text-muted-foreground">
              退款单 {confirmation.refund.id} · 订单 {confirmation.orderId} · ¥{' '}
              {yuan(confirmation.refund.amountCents)}
            </p>
          </>
        )
      }
      impact={
        succeeded
          ? [
              '退款单 → 已成功',
              '扣回本单尚未消耗的积分',
              '更新订单已退金额与退款状态',
              '写操作审计（含操作人、依据）',
            ]
          : [
              '退款单 → 已失败并关闭',
              '订单状态与金额保持不变',
              '积分保持不变',
              '写操作审计（含操作人、依据）',
            ]
      }
      extra={
        <>
          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">渠道退款号（可选）</span>
            <TextField
              ariaLabel="渠道退款号"
              value={providerRefundId}
              onChange={onProviderRefundIdChange}
              placeholder="填写渠道商户后台显示的退款单号"
              maxLength={120}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">人工核销依据</span>
            <TextField
              ariaLabel="人工核销依据"
              value={reason}
              onChange={onReasonChange}
              placeholder="如：已核对微信商户平台退款单，状态为退款成功"
              maxLength={300}
            />
          </div>
        </>
      }
    />
  );
}

export function BatchMarkPaidDialog({
  open,
  count,
  loading,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  count: number;
  loading: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!open) return null;
  return (
    <ConfirmDialog
      open
      title={`批量核销 ${count} 笔订单`}
      confirmText="确认已收款"
      loading={loading}
      onCancel={onCancel}
      onConfirm={onConfirm}
      description={
        <>
          <p>
            将为每笔订单生成一条 <b>channel=manual</b> 的支付流水，置为已支付并发放对应积分 /
            会员权益。
          </p>
          <p className="text-[12px] text-muted-foreground">
            只处理「待支付」状态的订单；已是已支付的订单会返回幂等命中而不重复发放。
          </p>
        </>
      }
      impact={[
        `共 ${count} 笔订单`,
        '每笔会生成一条手工核销流水',
        '发放对应的积分或会员权益',
        '写操作审计（含操作人）',
      ]}
    />
  );
}
