import { Link } from 'react-router-dom';
import { ActionButton, ConfirmDialog, ModalDialog, TextField } from '~/admin-ui/primitives';
import { yuan } from './utils';
import type { AdminOrderRefund, AdminOrderRow } from '../../../types/api';

/**
 * 退款规则入口（后台「支付与退费」独立工作台深链）。
 *
 * 退款被规则拒绝时（时间窗 / 比例上限 / 已消耗积分），运营要改的是规则本身。
 * 弹窗里直接给这个入口，省掉「先关弹窗、进设置、再找退款分组」。
 */
export const REFUND_RULES_HREF = '/admin/payment-rules#refund-rules';

export type RefundConfirmationTarget = {
  orderId: string;
  refund: AdminOrderRefund;
  outcome: 'succeeded' | 'failed';
};

export function OrderActionDialog({
  action,
  refundYuan,
  refundReason,
  markPaidNote,
  loading,
  onRefundYuanChange,
  onRefundReasonChange,
  onMarkPaidNoteChange,
  onCancel,
  onConfirm,
}: {
  action: { kind: 'markPaid' | 'refund'; row: AdminOrderRow } | null;
  refundYuan: string;
  refundReason: string;
  /** 手工核销依据。人工入账没有渠道报文，必须留下书面凭据 */
  markPaidNote: string;
  loading: boolean;
  onRefundYuanChange: (value: string) => void;
  onRefundReasonChange: (value: string) => void;
  onMarkPaidNoteChange: (value: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!action) return null;
  const isRefund = action.kind === 'refund';
  /*
   * 两个必填项在按钮上先拦住：格式错/没填原因跑到后端再弹 toast，
   * 等于让运营白等一次往返。后端校验保留作为最后一道。
   */
  const refundAmountValid = /^\d+(\.\d{1,2})?$/.test(refundYuan.trim()) && Number(refundYuan) > 0;
  const confirmDisabled = isRefund
    ? !refundAmountValid || !refundReason.trim()
    : !markPaidNote.trim();
  return (
    <ConfirmDialog
      open
      title={isRefund ? '订单退款' : '手工核销订单'}
      confirmText={isRefund ? '确认退款' : '确认已收款'}
      danger={isRefund}
      loading={loading}
      confirmDisabled={confirmDisabled}
      onCancel={onCancel}
      onConfirm={onConfirm}
      description={
        !isRefund ? (
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
        !isRefund
          ? [
              '订单状态 → 已支付',
              `发放 ${action.row.grantedCredits > 0 ? action.row.grantedCredits : '（按商品配置）'} 积分`,
              action.row.membershipPlanName
                ? `激活会员：${action.row.membershipPlanName}`
                : '不涉及会员',
              '核销依据会写进支付流水，供财务追溯',
            ]
          : [
              `退款金额 ¥ ${refundYuan || '未填'}`,
              '回收未消耗的积分（按批次剩余量）',
              '订单状态 → 已退款 / 部分退款',
            ]
      }
      extra={
        !isRefund ? (
          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">核销依据（必填）</span>
            <TextField
              ariaLabel="核销依据"
              value={markPaidNote}
              onChange={onMarkPaidNoteChange}
              placeholder="如：线下转账已到账，凭证号 20261111001"
              maxLength={200}
            />
            <span className="text-[12px] leading-5 text-muted-foreground">
              手工核销不产生渠道流水，这段文字是财务对账时唯一能解释这笔入账的依据。
            </span>
          </div>
        ) : (
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
        )
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
            ]
          : [
              '退款单 → 已失败并关闭',
              '订单状态与金额保持不变',
              '积分保持不变',
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
      ]}
    />
  );
}

export interface BatchMarkPaidFailure {
  orderNo: string;
  message: string;
}

/**
 * 批量核销结果。
 *
 * 逐条执行必然出现「部分成功」，后端也逐条返回了原因（`common/batch.ts`
 * 的 `results[].message`）。只报一句「失败 3 单」等于让运营自己在 40 行里
 * 猜是哪 3 单、为什么 —— 这里把订单号与原因摆出来，失败项还会保留勾选
 * 以便修完原因直接重试。
 */
export function BatchMarkPaidResultDialog({
  summary,
  onClose,
}: {
  summary: {
    total: number;
    succeeded: number;
    failed: number;
    failures: BatchMarkPaidFailure[];
  } | null;
  onClose: () => void;
}) {
  if (!summary) return null;
  return (
    <ModalDialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={`批量核销结果：成功 ${summary.succeeded} 笔，失败 ${summary.failed} 笔`}
      description="失败项已保留勾选。按下列原因处理后可直接重试，无需重新勾选。"
      size="md"
      footer={
        <ActionButton variant="secondary" size="sm" onClick={onClose}>
          关闭
        </ActionButton>
      }
    >
      <ul className="divide-y divide-border rounded-lg border border-border">
        {summary.failures.map((failure) => (
          <li key={failure.orderNo} className="flex flex-col gap-0.5 px-3 py-2">
            <code className="font-mono text-xs text-foreground">{failure.orderNo}</code>
            <span className="text-[12px] leading-4 text-danger-text">{failure.message}</span>
          </li>
        ))}
      </ul>
    </ModalDialog>
  );
}
