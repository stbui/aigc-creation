import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  AdminPage,
  ConfirmDialog,
  ContextBanner,
  ExportCsvButton,
  Panel,
  RefreshButton,
  SavedViewBar,
  StaleError,
} from '~/admin-ui/primitives';
import {
  readAdminActionContext,
  readAdminDone,
  withAdminDone,
} from '../../../lib/admin-context-link';
import { adminOrderPaymentApi, adminOrdersApi } from './api';
import { useAdmin, useAdminDetailParam, useSelectionPrune, useToast } from './hooks';
import { yuan, yuanToCents } from './utils';
import { OrderDetailDrawer } from './OrderDetailDrawer';
import { OrderFilterBar } from './OrderFilterBar';
import { OrderDeleteConfirm } from './OrderDeleteConfirm';
import { OrderTable } from './OrderTable';
import {
  BatchMarkPaidDialog,
  BatchMarkPaidResultDialog,
  OrderActionDialog,
  RefundConfirmationDialog,
  type RefundConfirmationTarget,
} from './OrderConfirmationDialogs';
import { refundWarningMessage } from './refundResultMessage';
import { refundRuleHint } from './refundRuleHint';
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
 * 并回收积分。两者都保留完整业务记录，金额与依据可追溯。
 *
 * ## 模块划分
 *
 * 筛选、URL 同步与导出在 `useOrderFilters`；详情、筛选条和表格各有展示组件；
 * 本文件保留批量选择与写操作编排。
 */
export function AdminOrdersPage() {
  const toast = useToast();
  const { can } = useAdmin();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const actionContext = readAdminActionContext(searchParams);
  const done = readAdminDone(searchParams);
  const [selected, setSelected] = useState<string[]>([]);

  const {
    values,
    updateFilter,
    applyQuery,
    applyView,
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

  /*
   * 换筛选会清空勾选；翻页不经过 onQueryChange，因此再按当前页裁剪一次，
   * 保证批量核销只作用于屏幕上可见的订单。
   */
  const visibleOrderIds = useMemo(() => (data?.items ?? []).map((row) => row.id), [data]);
  useSelectionPrune(setSelected, visibleOrderIds);

  const [detailId, setDetailId] = useAdminDetailParam();
  const [action, setAction] = useState<{ kind: 'markPaid' | 'refund'; row: AdminOrderRow } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AdminOrderRow | null>(null);
  /** 支付域动作：查单 / 关单。与退款共用同一套确认弹窗语义，但不退款 */
  const [payAction, setPayAction] = useState<{ kind: 'query' | 'close'; row: AdminOrderRow } | null>(null);
  /** 退款金额（元）。打开弹窗时预填可退上限 */
  const [refundYuan, setRefundYuan] = useState('');
  const [refundReason, setRefundReason] = useState('');
  /** 手工核销依据。人工入账没有渠道报文，必填并写进支付流水 */
  const [markPaidNote, setMarkPaidNote] = useState('');
  /** 批量核销的部分失败清单（订单号 + 原因），null = 无失败需要展示 */
  const [batchFailures, setBatchFailures] = useState<{
    total: number;
    succeeded: number;
    failed: number;
    failures: Array<{ orderNo: string; message: string }>;
  } | null>(null);
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
    setMarkPaidNote('');
    // 默认退款金额 = 可退上限 (实付 - 已退)。部分退款时运营只需改小
    setRefundYuan(kind === 'refund' ? yuan(Math.max(row.paidCents - row.refundedCents, 0)) : '');
  };

  /**
   * 从工单/工作台带 `returnTo` 进入时，动作完成后回来源并标记结果。
   * 没有来源就保持原行为：留在订单页并刷新。
   */
  const returnToSource = (doneKey: string) => {
    if (actionContext.returnTo) navigate(withAdminDone(actionContext.returnTo, doneKey));
  };
  const fromLabel = actionContext.from?.startsWith('ticket:')
    ? `工单 ${actionContext.from.slice('ticket:'.length)}`
    : actionContext.from === 'workbench'
      ? '工作台待办'
      : actionContext.from ?? '';
  const intentLabel =
    actionContext.intent === 'refund'
      ? '准备为这笔订单退款'
      : actionContext.intent === 'confirmRefund'
        ? '核对渠道退款结果'
        : actionContext.intent === 'markPaid'
          ? '准备手工核销'
          : '查看订单';

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
      setDetailVersion((value) => value + 1);
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
        const orderNoById = new Map((data?.items ?? []).map((row) => [row.id, row.orderNo]));
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

  return (
    <AdminPage
      title="订单管理"
      description="订单、支付与退款。核销、渠道查单、关单与退款均保留业务记录；关单不退款。"
    >

      {(actionContext.from || done) && (
        <ContextBanner
          title={
            done
              ? done === 'refunded'
                ? '该订单已退款'
                : done === 'refund_confirmed'
                  ? '渠道退款结果已确认'
                  : '该订单已标记为已支付'
              : `来自${fromLabel}`
          }
          detail={done ? undefined : intentLabel}
          returnTo={actionContext.returnTo}
        />
      )}

      <OrderFilterBar
        values={values}
        onChange={updateFilter}
        onApply={applyQuery}
        onReset={reset}
        appliedChips={appliedChips}
      />

      <SavedViewBar
        pageKey="orders"
        currentFilters={{
          status: values.status,
          refundState: values.refundState,
          orderNo: values.orderNo || undefined,
          email: values.email || undefined,
          channel: values.channel,
          from: values.from || undefined,
          to: values.to || undefined,
        }}
        onApply={(next) => {
          setSelected([]);
          applyView({
            status: next.status,
            refundState: next.refundState,
            orderNo: next.orderNo,
            email: next.email,
            channel: next.channel,
            from: next.from,
            to: next.to,
          });
        }}
      />

      <Panel
        title="订单列表"
        note="日期筛选含结束当天；导出口径与当前筛选一致"
        extra={
          <>
            {can('data.export') && <ExportCsvButton exporting={exporting} onExport={exportCsv} />}
            <RefreshButton loading={loading} onRefresh={reload} />
          </>
        }
      >
        {/* 刷新失败但手上还有上一次的数据: 只挂提示, 不把整个列表藏起来 */}
        {error && data && <StaleError error={error} onRetry={reload} />}

        <OrderTable
          rows={data?.items ?? []}
          loading={loading}
          error={error && !data ? error : null}
          selected={selected}
          page={data?.page ?? 1}
          pageSize={data?.pageSize ?? 20}
          total={data?.total ?? 0}
          hasFilter={hasFilter}
          canMarkPaid={can('order.mark_paid')}
          canRefund={can('order.refund')}
          canDelete={can('order.delete')}
          canPaymentOperate={can('payment.operate')}
          busy={busy}
          onRetry={reload}
          onSelectedChange={setSelected}
          onPageChange={setPage}
          onOpenDetail={setDetailId}
          onAction={openAction}
          onDelete={requestDelete}
          onPaymentAction={(kind, row) => setPayAction({ kind, row })}
          onBatchMarkPaid={() => setBatchOpen(true)}
          onReset={reset}
        />
      </Panel>

      <OrderDetailDrawer
        key={`${detailId ?? 'closed'}-${detailVersion}`}
        detailId={detailId}
        rows={data?.items ?? []}
        canMarkPaid={can('order.mark_paid')}
        canRefund={can('order.refund')}
        canPaymentOperate={can('payment.operate')}
        initialIntent={
          actionContext.intent === 'refund' ||
          actionContext.intent === 'confirmRefund' ||
          actionContext.intent === 'markPaid'
            ? actionContext.intent
            : null
        }
        onClose={() => setDetailId(null)}
        onAction={openAction}
        onPaymentAction={(kind, row) => setPayAction({ kind, row })}
        onConfirmRefund={openRefundConfirmation}
      />

      <OrderActionDialog
        action={action}
        refundYuan={refundYuan}
        refundReason={refundReason}
        markPaidNote={markPaidNote}
        loading={busy}
        onRefundYuanChange={setRefundYuan}
        onRefundReasonChange={setRefundReason}
        onMarkPaidNoteChange={setMarkPaidNote}
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

      <ConfirmDialog
        open={payAction !== null}
        danger={payAction?.kind === 'close'}
        title={payAction?.kind === 'close' ? '关闭支付订单' : '向渠道同步订单状态'}
        description={
          payAction?.kind === 'close'
            ? '关闭后该订单不再等待支付。已支付的订单不会被关闭，请先同步状态确认。'
            : '向渠道查一次订单状态；若渠道已收款，会立即入账并补发积分。'
        }
        impact={
          payAction?.kind === 'close'
            ? ['未支付订单将标记为已取消', '已支付订单会被拒绝关闭，请先同步状态', '关闭不会退款']
            : ['若渠道已收款，积分会立即入账']
        }
        confirmText={payAction?.kind === 'close' ? '确认关闭' : '确认同步'}
        loading={busy}
        onCancel={() => setPayAction(null)}
        onConfirm={() => void runPayAction()}
      />

      <OrderDeleteConfirm
        target={deleteTarget}
        loading={busy}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => void runDelete()}
      />

      <BatchMarkPaidDialog
        open={batchOpen}
        count={selected.length}
        loading={busy}
        onCancel={() => setBatchOpen(false)}
        onConfirm={() => void runBatchMarkPaid()}
      />

      <BatchMarkPaidResultDialog summary={batchFailures} onClose={() => setBatchFailures(null)} />
    </AdminPage>
  );
}
