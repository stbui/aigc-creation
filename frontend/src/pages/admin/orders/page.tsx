import { useState } from 'react';
import { ActionButton, ExportCsvButton, PageHeader, StaleError } from '~/admin-ui/primitives';
import { adminOrdersApi } from './api';
import { useAdmin, useAdminDetailParam, useToast } from './hooks';
import { yuan, yuanToCents } from './utils';
import { OrderDetailDrawer } from './OrderDetailDrawer';
import { OrderFilterBar } from './OrderFilterBar';
import { OrderTable } from './OrderTable';
import {
  BatchMarkPaidDialog,
  OrderActionDialog,
  RefundConfirmationDialog,
  type RefundConfirmationTarget,
} from './OrderConfirmationDialogs';
import { refundWarningMessage } from './refundResultMessage';
import { useOrderFilters } from './useOrderFilters';
import type { AdminOrderRefund, AdminOrderRow } from '../../../types/api';

/**
 * 订单管理 (B-39~B-44)。
 *
 * ## 客服视角的参数设计
 *
 * 最高频的问法是「我是 xxx@yy.com，上周买的，怎么没到账」。所以筛选必须支持
 * 邮箱 + 日期范围, 而且日期只填到「日」就该包含整天 —— 让客服为查一个订单
 * 去算 23:59:59 是错误的复杂度。
 *
 * ## 核销与退款都是「钱的动作」
 *
 * 核销造一条 channel=manual 的支付流水 (交易号带管理员 id), 退款写 Refund 记录
 * 并回收积分。两者都进操作审计，审计原因由系统按操作上下文生成。
 *
 * ## 模块划分
 *
 * 筛选、URL 同步与导出在 `useOrderFilters`；详情、筛选条和表格各有展示组件；
 * 本文件保留批量选择与写操作编排。
 */
export function AdminOrdersPage() {
  const toast = useToast();
  const { can } = useAdmin();
  const [selected, setSelected] = useState<string[]>([]);

  const {
    values,
    updateFilter,
    applyQuery,
    reset,
    appliedChips,
    hasFilter,
    data,
    loading,
    error,
    setPage,
    reload,
    exporting,
    exportCsv,
  } = useOrderFilters({ onQueryChange: () => setSelected([]) });

  const [detailId, setDetailId] = useAdminDetailParam();
  const [action, setAction] = useState<{ kind: 'markPaid' | 'refund'; row: AdminOrderRow } | null>(null);
  /** 退款金额（元）。打开弹窗时预填可退上限 */
  const [refundYuan, setRefundYuan] = useState('');
  const [refundReason, setRefundReason] = useState('');
  const [refundConfirmation, setRefundConfirmation] = useState<RefundConfirmationTarget | null>(null);
  const [refundConfirmationReason, setRefundConfirmationReason] = useState('');
  const [refundProviderId, setRefundProviderId] = useState('');
  /** 核销后让已打开的详情抽屉重新拉取，而不是要求运营关掉再打开 */
  const [detailVersion, setDetailVersion] = useState(0);
  const [busy, setBusy] = useState(false);

  /*
   * 批量核销。只做「待支付 → 已支付」这一个方向:
   * 批量退款每单金额不同、还要逐单确认可退上限, 合在一个弹窗里必出错。
   */
  const [batchOpen, setBatchOpen] = useState(false);

  const openAction = (kind: 'markPaid' | 'refund', row: AdminOrderRow) => {
    setAction({ kind, row });
    setRefundReason('');
    // 默认退款金额 = 可退上限 (实付 - 已退)。部分退款时运营只需改小
    setRefundYuan(kind === 'refund' ? yuan(Math.max(row.paidCents - row.refundedCents, 0)) : '');
  };

  const runAction = async () => {
    if (!action) return;

    let refundCents: number | null = null;
    let refundNote = '';
    if (action.kind === 'refund') {
      refundCents = yuanToCents(refundYuan);
      if (refundCents === null) {
        toast.error('退款金额格式不正确');
        return;
      }
      refundNote = refundReason.trim();
      if (!refundNote) {
        toast.error('请填写退款原因');
        return;
      }
    }

    setBusy(true);
    try {
      if (action.kind === 'markPaid') {
        const result = await adminOrdersApi.markPaid(action.row.id);
        toast.success(
          result.idempotentHit ? `订单已是已支付状态（${result.message ?? '幂等命中'}）` : '已标记为已支付并发放权益',
        );
      } else {
        const result = await adminOrdersApi.refund(action.row.id, refundCents as number, refundNote);
        /*
         * 渠道异步处理中 (微信可能返回 PROCESSING): 钱还没到账、积分也没回收,
         * 不能显示「已退款」。如实提示需要到渠道后台确认 —— 这是本仓库没有
         * 退款回调端点时的既有边界, 装作成功会让财务提前销账。
         */
        if (result.state === 'processing') {
          toast.warning(result.message || '渠道已受理退款但仍在处理中，请到渠道商户后台确认');
        } else {
          // 积分无法全额回收、待开发票需驳回、已开票需冲红都不能被“成功”字样淹没。
          const warning = refundWarningMessage(result);
          if (warning) {
            toast.warning(`已退款 ¥${yuan(refundCents as number)}；${warning}`);
          } else {
            toast.success(`已退款 ¥${yuan(refundCents as number)}，回收积分 ${result.creditsReclaimed}`);
          }
        }
      }
      setAction(null);
      setDetailId(null);
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '操作失败');
    } finally {
      setBusy(false);
    }
  };

  const openRefundConfirmation = (orderId: string, refund: AdminOrderRefund, outcome: 'succeeded' | 'failed') => {
    setRefundConfirmation({ orderId, refund, outcome });
    setRefundConfirmationReason('');
    setRefundProviderId(refund.providerRefundId ?? '');
  };

  const runRefundConfirmation = async () => {
    if (!refundConfirmation) return;
    const reason = refundConfirmationReason.trim();
    if (!reason) {
      toast.error('请填写人工核销依据');
      return;
    }
    setBusy(true);
    try {
      const result = await adminOrdersApi.confirmRefund(refundConfirmation.orderId, refundConfirmation.refund.id, {
        outcome: refundConfirmation.outcome,
        providerRefundId: refundProviderId.trim() || undefined,
        reason,
      });
      if (result.state === 'failed') {
        toast.success('已确认退款失败；订单状态与积分未变更');
      } else {
        const warning = refundWarningMessage(result);
        if (warning) {
          toast.warning(`已确认退款成功；${warning}`);
        } else {
          toast.success(`已确认退款成功，回收积分 ${result.creditsReclaimed}`);
        }
      }
      setRefundConfirmation(null);
      setDetailVersion((value) => value + 1);
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '退款核销失败');
    } finally {
      setBusy(false);
    }
  };

  const runBatchMarkPaid = async () => {
    if (selected.length === 0) return;
    setBusy(true);
    try {
      const summary = await adminOrdersApi.batchMarkPaid(selected);
      if (summary.failed > 0) {
        toast.warning(`批量核销完成：成功 ${summary.succeeded} 单，失败 ${summary.failed} 单`);
      } else {
        toast.success(`批量核销完成：成功 ${summary.succeeded} 单`);
      }
      setBatchOpen(false);
      setSelected([]);
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '批量核销失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title="订单管理"
        description="订单、支付与退款。核销与退款会写入操作审计，并即时回收或发放积分。"
        actions={can('data.export') ? <ExportCsvButton exporting={exporting} onExport={exportCsv} /> : undefined}
      />

      <OrderFilterBar
        values={values}
        onChange={updateFilter}
        onApply={applyQuery}
        onReset={reset}
        appliedChips={appliedChips}
      />

      {/* 刷新失败但手上还有上一次的数据: 只挂提示, 不把整个列表藏起来 */}
      {error && data && <StaleError error={error} onRetry={reload} />}

      <OrderTable
        rows={data?.items ?? []}
        loading={loading}
        error={error}
        selected={selected}
        page={data?.page ?? 1}
        pageSize={data?.pageSize ?? 20}
        total={data?.total ?? 0}
        hasFilter={hasFilter}
        canMarkPaid={can('order.mark_paid')}
        canRefund={can('order.refund')}
        busy={busy}
        onRetry={reload}
        onSelectedChange={setSelected}
        onPageChange={setPage}
        onOpenDetail={setDetailId}
        onAction={openAction}
        onBatchMarkPaid={() => setBatchOpen(true)}
        onReset={reset}
      />

      <OrderDetailDrawer
        key={`${detailId ?? 'closed'}-${detailVersion}`}
        detailId={detailId}
        rows={data?.items ?? []}
        canMarkPaid={can('order.mark_paid')}
        canRefund={can('order.refund')}
        onClose={() => setDetailId(null)}
        onAction={openAction}
        onConfirmRefund={openRefundConfirmation}
      />

      <OrderActionDialog
        action={action}
        refundYuan={refundYuan}
        refundReason={refundReason}
        loading={busy}
        onRefundYuanChange={setRefundYuan}
        onRefundReasonChange={setRefundReason}
        onCancel={() => setAction(null)}
        onConfirm={() => void runAction()}
      />

      <RefundConfirmationDialog
        confirmation={refundConfirmation}
        reason={refundConfirmationReason}
        providerRefundId={refundProviderId}
        loading={busy}
        onReasonChange={setRefundConfirmationReason}
        onProviderRefundIdChange={setRefundProviderId}
        onCancel={() => setRefundConfirmation(null)}
        onConfirm={() => void runRefundConfirmation()}
      />

      <BatchMarkPaidDialog
        open={batchOpen}
        count={selected.length}
        loading={busy}
        onCancel={() => setBatchOpen(false)}
        onConfirm={() => void runBatchMarkPaid()}
      />
    </>
  );
}
