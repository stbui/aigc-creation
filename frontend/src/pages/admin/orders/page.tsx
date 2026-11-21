import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  AdminPage,
  ContextBanner,
  ExportCsvButton,
  Panel,
  RefreshButton,
  SavedViewBar,
  StaleError,
} from './components';
import { useAdmin, useAdminDetailParam, useSelectionPrune } from './hooks';
import { readAdminActionContext, readAdminDone, withAdminDone } from './utils';
import { OrderDetailDrawer } from './OrderDetailDrawer';
import { OrderFilterBar } from './OrderFilterBar';
import { OrderTable } from './OrderTable';
import { OrderActionDialogs } from './OrderActionDialogs';
import { useOrderActions } from './useOrderActions';
import { useOrderFilters } from './useOrderFilters';

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
 * 筛选、URL 同步与导出在 `useOrderFilters`；钱的动作编排在 `useOrderActions`，
 * 配套弹窗集中在 `OrderActionDialogs`；详情、筛选条和表格各有展示组件。
 * 本文件只做页面编排：来源上下文、列表、抽屉与批量选择。
 */
export function AdminOrdersPage() {
  const { can } = useAdmin();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const actionContext = readAdminActionContext(searchParams);
  const done = readAdminDone(searchParams);
  const [selected, setSelected] = useState<string[]>([]);

  const {
    values,
    appliedFilters,
    draftFilters,
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
  /** 核销后让已打开的详情抽屉重新拉取，而不是要求运营关掉再打开 */
  const [detailVersion, setDetailVersion] = useState(0);

  /**
   * 从工单/工作台带 `returnTo` 进入时，动作完成后回来源并标记结果。
   * 没有来源就保持原行为：留在订单页并刷新。
   */
  const returnToSource = (doneKey: string) => {
    if (actionContext.returnTo) navigate(withAdminDone(actionContext.returnTo, doneKey));
  };

  const actions = useOrderActions({
    rows: data?.items ?? [],
    selected,
    setSelected,
    reload,
    detailId,
    setDetailId,
    returnToSource,
    onDetailChanged: () => setDetailVersion((value) => value + 1),
  });

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
        appliedFilters={appliedFilters}
        draftFilters={draftFilters}
        onApplyDraft={applyQuery}
        onApply={(next) => {
          setSelected([]);
          applyView({
            status: next.status,
            refundState: next.refundState,
            orderNo: next.orderNo,
            email: next.email,
            channel: next.channel,
            productId: next.productId,
            productName: next.productName,
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
          busy={actions.busy}
          onRetry={reload}
          onSelectedChange={setSelected}
          onPageChange={setPage}
          onOpenDetail={setDetailId}
          onAction={actions.openAction}
          onDelete={actions.requestDelete}
          onPaymentAction={(kind, row) => actions.setPayAction({ kind, row })}
          onBatchMarkPaid={() => actions.setBatchOpen(true)}
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
        onAction={actions.openAction}
        onPaymentAction={(kind, row) => actions.setPayAction({ kind, row })}
        onConfirmRefund={actions.openRefundConfirmation}
      />

      <OrderActionDialogs actions={actions} />
    </AdminPage>
  );
}
