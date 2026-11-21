import { ConfirmDialog } from './components';
import { OrderDeleteConfirm } from './OrderDeleteConfirm';
import {
  BatchMarkPaidDialog,
  BatchMarkPaidResultDialog,
  OrderActionDialog,
  RefundConfirmationDialog,
} from './OrderConfirmationDialogs';
import type { OrderActions } from './useOrderActions';

/**
 * 订单页的五类确认弹窗。
 *
 * 全部由 `useOrderActions` 的状态驱动：页面只挂一次，不在业务片段里各写一份，
 * 避免「某个入口打开退款弹窗时忘了带忙碌锁」。
 */
export function OrderActionDialogs({ actions }: { actions: OrderActions }) {
  return (
    <>
      <OrderActionDialog
        action={actions.action}
        refundYuan={actions.refundYuan}
        refundReason={actions.refundReason}
        markPaidNote={actions.markPaidNote}
        loading={actions.busy}
        onRefundYuanChange={actions.setRefundYuan}
        onRefundReasonChange={actions.setRefundReason}
        onMarkPaidNoteChange={actions.setMarkPaidNote}
        onCancel={() => actions.setAction(null)}
        onConfirm={() => void actions.runAction()}
      />

      <RefundConfirmationDialog
        confirmation={actions.refundConfirmation}
        reason={actions.refundConfirmationReason}
        providerRefundId={actions.refundProviderId}
        loading={actions.busy}
        onReasonChange={actions.setRefundConfirmationReason}
        onProviderRefundIdChange={actions.setRefundProviderId}
        onCancel={() => actions.setRefundConfirmation(null)}
        onConfirm={() => void actions.runRefundConfirmation()}
      />

      <ConfirmDialog
        open={actions.payAction !== null}
        danger={actions.payAction?.kind === 'close'}
        title={actions.payAction?.kind === 'close' ? '关闭支付订单' : '向渠道同步订单状态'}
        description={
          actions.payAction?.kind === 'close'
            ? '关闭后该订单不再等待支付。已支付的订单不会被关闭，请先同步状态确认。'
            : '向渠道查一次订单状态；若渠道已收款，会立即入账并补发积分。'
        }
        impact={
          actions.payAction?.kind === 'close'
            ? ['未支付订单将标记为已取消', '已支付订单会被拒绝关闭，请先同步状态', '关闭不会退款']
            : ['若渠道已收款，积分会立即入账']
        }
        confirmText={actions.payAction?.kind === 'close' ? '确认关闭' : '确认同步'}
        loading={actions.busy}
        onCancel={() => actions.setPayAction(null)}
        onConfirm={() => void actions.runPayAction()}
      />

      <OrderDeleteConfirm
        target={actions.deleteTarget}
        loading={actions.busy}
        onCancel={() => actions.setDeleteTarget(null)}
        onConfirm={() => void actions.runDelete()}
      />

      <BatchMarkPaidDialog
        open={actions.batchOpen}
        count={actions.selectedCount}
        loading={actions.busy}
        onCancel={() => actions.setBatchOpen(false)}
        onConfirm={() => void actions.runBatchMarkPaid()}
      />

      <BatchMarkPaidResultDialog summary={actions.batchFailures} onClose={() => actions.setBatchFailures(null)} />
    </>
  );
}
