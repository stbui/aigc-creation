import { useState } from 'react';

import { adminOrderPaymentApi, adminOrdersApi } from './api';
import { useToast } from './hooks';
import { yuan, yuanToCents } from './utils';
import { refundWarningMessage } from './refundResultMessage';
import { refundRuleHint } from './refundRuleHint';
import type { RefundConfirmationTarget } from './OrderConfirmationDialogs';
import type { AdminOrderRefund, AdminOrderRow } from './types';

/** 批量核销的部分失败清单：哪几单、为什么失败，逐条展示。 */
export interface BatchFailureSummary {
  total: number;
  succeeded: number;
  failed: number;
  failures: Array<{ orderNo: string; message: string }>;
}

/**
 * 订单页的「钱的动作」编排：核销、退款、查单 / 关单、删除、批量核销。
 *
 * 抽成 hook 而不是留在页面里，是因为每条动作都要同时维护「弹窗状态 + 忙碌锁 +
 * 成功后刷新 + 失败文案分工」，散在 JSX 中间时最容易被新加的动作忘掉其中一项，
 * 例如退款后忘记让已打开的详情抽屉重新拉取。
 */
export function useOrderActions({
  rows,
  selected,
  setSelected,
  reload,
  detailId,
  setDetailId,
  returnToSource,
  onDetailChanged,
}: {
  rows: AdminOrderRow[];
  selected: string[];
  setSelected: (next: string[] | ((current: string[]) => string[])) => void;
  reload: () => void;
  detailId: string | null;
  setDetailId: (id: string | null) => void;
  returnToSource: (doneKey: string) => void;
  onDetailChanged: () => void;
}) {
  const toast = useToast();

  const [action, setAction] = useState<{ kind: 'markPaid' | 'refund'; row: AdminOrderRow } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AdminOrderRow | null>(null);
  /** 支付域动作：查单 / 关单。与退款共用同一套确认弹窗语义，但不退款 */
  const [payAction, setPayAction] = useState<{ kind: 'query' | 'close'; row: AdminOrderRow } | null>(null);
  /** 退款金额（元）。打开弹窗时预填可退上限 */
  const [refundYuan, setRefundYuan] = useState('');
  const [refundReason, setRefundReason] = useState('');
  /** 手工核销依据。人工入账没有渠道报文，必填并写进支付流水 */
  const [markPaidNote, setMarkPaidNote] = useState('');
  const [batchFailures, setBatchFailures] = useState<BatchFailureSummary | null>(null);
  const [refundConfirmation, setRefundConfirmation] = useState<RefundConfirmationTarget | null>(null);
  const [refundConfirmationReason, setRefundConfirmationReason] = useState('');
  const [refundProviderId, setRefundProviderId] = useState('');
  /*
   * 批量核销。只做「待支付 → 已支付」这一个方向:
   * 批量退款每单金额不同、还要逐单确认可退上限, 合在一个弹窗里必出错。
   */
  const [batchOpen, setBatchOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const openAction = (kind: 'markPaid' | 'refund', row: AdminOrderRow) => {
    setAction({ kind, row });
    setRefundReason('');
    setMarkPaidNote('');
    // 默认退款金额 = 可退上限 (实付 - 已退)。部分退款时运营只需改小
    setRefundYuan(kind === 'refund' ? yuan(Math.max(row.paidCents - row.refundedCents, 0)) : '');
  };

  const runAction = async () => {
    if (!action) return;

    let refundCents: number | null = null;
    let refundNote = '';
    let note = '';
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
    } else {
      /*
       * 核销依据必填：人工入账没有渠道流水，不留下「为什么算收到钱」，
       * 财务对账时这笔钱就是一笔无来源的入账。
       */
      note = markPaidNote.trim();
      if (!note) {
        toast.error('请填写核销依据');
        return;
      }
    }

    setBusy(true);
    try {
      if (action.kind === 'markPaid') {
        const result = await adminOrdersApi.markPaid(action.row.id, note);
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
      returnToSource(action.kind === 'refund' ? 'refunded' : 'marked_paid');
    } catch (e) {
      /*
       * 退款被拒要分清「金额填错」与「规则要改」：两类过去同形，运营只能
       * 反复改金额试。业务码翻译成下一步（见 refundRuleHint）。
       */
      const hint = refundRuleHint(e);
      toast.error(hint ? `${(e as Error).message} ${hint}` : (e as Error).message || '操作失败');
    } finally {
      setBusy(false);
    }
  };

  const requestDelete = (row: AdminOrderRow) => {
    if (row.status !== 'pending' && row.status !== 'cancelled') {
      toast.error('只有待支付或已取消订单可删除；已支付订单请使用退款流程');
      return;
    }
    if (row.paymentCount > 0) {
      toast.error('该订单已有支付尝试记录，不能删除；请保留用于追溯');
      return;
    }
    setDeleteTarget(row);
  };

  const runDelete = async () => {
    if (!deleteTarget) return;
    setBusy(true);
    try {
      await adminOrdersApi.remove(deleteTarget.id);
      toast.success(`已删除订单 ${deleteTarget.orderNo}`);
      if (detailId === deleteTarget.id) setDetailId(null);
      setSelected((current) => current.filter((id) => id !== deleteTarget.id));
      setDeleteTarget(null);
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '删除订单失败');
    } finally {
      setBusy(false);
    }
  };

  /**
   * 查单 / 关单。
   *
   * 两者都只处理**未支付**订单：查单以渠道事实为准（已收款则立即入账并补发
   * 积分），关单只停止继续等待支付。关单不退款 —— 已支付订单必须走退款流程，
   * 否则「关闭」会被误读成「退钱」。
   */
  const runPayAction = async () => {
    if (!payAction) return;
    setBusy(true);
    try {
      if (payAction.kind === 'query') {
        await adminOrderPaymentApi.query(payAction.row.id);
        toast.success('已同步渠道状态');
      } else {
        await adminOrderPaymentApi.close(payAction.row.id);
        toast.success(`订单 ${payAction.row.orderNo} 已关闭`);
      }
      setPayAction(null);
      onDetailChanged();
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
      onDetailChanged();
      reload();
      returnToSource('refund_confirmed');
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
        /*
         * 后端逐条返回了失败原因（common/batch.ts），必须展示出来 ——
         * 「失败 3 单」不告诉运营是哪 3 单、为什么，等于把排查成本
         * 又推回给人工比对。失败项保留勾选，修完原因可直接重试。
         */
        const orderNoById = new Map(rows.map((row) => [row.id, row.orderNo]));
        const failures = summary.results
          .filter((item) => !item.ok)
          .map((item) => ({
            orderNo: orderNoById.get(item.id) ?? item.id,
            message: item.message ?? '未返回失败原因',
          }));
        setBatchFailures({
          total: summary.total,
          succeeded: summary.succeeded,
          failed: summary.failed,
          failures,
        });
        setSelected(summary.results.filter((item) => !item.ok).map((item) => item.id));
        toast.warning(`批量核销完成：成功 ${summary.succeeded} 单，失败 ${summary.failed} 单`);
      } else {
        toast.success(`批量核销完成：成功 ${summary.succeeded} 单`);
        setSelected([]);
      }
      setBatchOpen(false);
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '批量核销失败');
    } finally {
      setBusy(false);
    }
  };

  return {
    /* 状态 */
    action,
    deleteTarget,
    payAction,
    refundYuan,
    refundReason,
    markPaidNote,
    batchFailures,
    refundConfirmation,
    refundConfirmationReason,
    refundProviderId,
    batchOpen,
    busy,
    selectedCount: selected.length,
    /* 回写 */
    setAction,
    setDeleteTarget,
    setPayAction,
    setRefundYuan,
    setRefundReason,
    setMarkPaidNote,
    setBatchFailures,
    setRefundConfirmation,
    setRefundConfirmationReason,
    setRefundProviderId,
    setBatchOpen,
    /* 动作 */
    openAction,
    runAction,
    requestDelete,
    runDelete,
    runPayAction,
    openRefundConfirmation,
    runRefundConfirmation,
    runBatchMarkPaid,
  };
}

export type OrderActions = ReturnType<typeof useOrderActions>;
