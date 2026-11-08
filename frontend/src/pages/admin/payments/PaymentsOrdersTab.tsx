import { useState } from 'react';
import { adminPaymentOrdersApi } from './api';
import {
  ActionButton,
  AdminDataTable,
  ConfirmDialog,
  Panel,
  StaleError,
  StatusTag,
  formatShanghaiDateTimeShort,
  type AdminColumn,
} from '~/admin-ui/primitives';
import {
  useAdmin,
  useAdminDetailParam,
  usePaymentOrderFilters,
  useRefreshOnNonce,
  useToast,
} from './hooks';
import type { AdminPaymentOrderRow } from '../../../types/payment';
import { PAYMENT_STATUS_META, paymentActions } from './constants';
import { moneyText, providerLabel } from './utils';
import { PaymentOrderDetailDrawer } from './PaymentOrderDetailDrawer';
import { PaymentOrdersFilterBar } from './PaymentOrdersFilterBar';

/**
 * 支付订单标签。
 *
 * 筛选是**草稿 → 应用**两段式：草稿改完点「查询」才生效。这样「改了条件但
 * 没点查询」不会让人以为筛选没生效（列表还停在旧条件上，用户会以为筛错了）。
 *
 * 页面**不提供退款**：退款在订单管理里，且退款要动积分与优惠券回滚，
 * 放在支付域会让人以为「关单 = 退款」。关单只停止未支付订单继续挂着。
 *
 * 筛选、地址栏同步与导出都在 `usePaymentOrderFilters`；这里只保留渲染与
 * 查单 / 关单两个写操作。
 */

export function PaymentsOrdersTab({ refreshNonce }: { refreshNonce: number }) {
  const toast = useToast();
  const { can } = useAdmin();
  const canExport = can('data.export');

  const {
    data,
    loading,
    error,
    values,
    updateFilter,
    applyFilters,
    resetFilters,
    draftChanged,
    appliedChips,
    setPage,
    reload,
    exporting,
    exportCsv,
  } = usePaymentOrderFilters();

  // 刷新只重取当前筛选下的数据，筛选与分页都不动
  useRefreshOnNonce(refreshNonce, reload);

  const [detailId, setDetailId] = useAdminDetailParam('orderId');
  const [action, setAction] = useState<{
    order: AdminPaymentOrderRow;
    kind: 'query' | 'close';
  } | null>(null);
  const [busy, setBusy] = useState(false);

  const rows = data?.items ?? [];
  const hasFilter = appliedChips.length > 0;

  const columns: Array<AdminColumn<AdminPaymentOrderRow>> = [
    {
      key: 'user',
      title: '用户',
      width: 180,
      render: (row) =>
        row.user ? (
          <div className="flex flex-col gap-0.5">
            <span className="truncate">{row.user.name || row.user.email}</span>
            <span className="truncate text-[12px] text-muted-foreground">{row.user.email}</span>
          </div>
        ) : (
          <span className="text-muted-foreground">用户不存在</span>
        ),
    },
    {
      key: 'order',
      title: '订单 / 商品',
      width: 220,
      render: (row) => (
        <div className="flex flex-col gap-0.5">
          <code className="font-mono text-[12px]">{row.orderNo}</code>
          <span className="truncate text-[12px] text-muted-foreground">{row.productName}</span>
        </div>
      ),
    },
    {
      key: 'provider',
      title: '渠道',
      width: 100,
      render: (row) => <span className="text-muted-foreground">{providerLabel(row.providerId)}</span>,
    },
    {
      key: 'amount',
      title: '金额 / 权益',
      width: 130,
      render: (row) => (
        <div className="flex flex-col gap-0.5">
          <span className="tabular-nums">{moneyText(row.amountCents, row.currency)}</span>
          <span className="text-[12px] text-muted-foreground">
            {row.credits.toLocaleString('zh-CN')} 积分
          </span>
        </div>
      ),
    },
    {
      key: 'status',
      title: '状态',
      width: 100,
      render: (row) => {
        const meta = PAYMENT_STATUS_META[row.status];
        return (
          <StatusTag
            status={row.status}
            tone={meta?.tone ?? 'muted'}
            label={meta?.label ?? row.status}
          />
        );
      },
    },
    {
      key: 'createdAt',
      title: '创建时间',
      width: 110,
      render: (row) => (
        <span className="text-[12px] text-muted-foreground tabular-nums">
          {formatShanghaiDateTimeShort(row.createdAt)}
        </span>
      ),
    },
    {
      key: 'actions',
      title: '操作',
      width: 160,
      render: (row) => {
        const { canQuery, canClose } = paymentActions(row.status);
        return (
          <div className="flex items-center gap-1">
            <ActionButton onClick={() => setDetailId(row.id)} ariaLabel={`查看订单${row.orderNo}`}>
              详情
            </ActionButton>
            {canQuery && (
              <ActionButton
                onClick={() => setAction({ order: row, kind: 'query' })}
                ariaLabel={`同步状态${row.orderNo}`}
              >
                同步状态
              </ActionButton>
            )}
            {canClose && (
              <ActionButton
                onClick={() => setAction({ order: row, kind: 'close' })}
                ariaLabel={`关闭订单${row.orderNo}`}
              >
                关闭
              </ActionButton>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <div className="flex flex-col gap-3">
      <PaymentOrdersFilterBar
        values={values}
        onChange={updateFilter}
        onApply={applyFilters}
        onReset={resetFilters}
        onExport={exportCsv}
        exporting={exporting}
        exportDisabled={!canExport || draftChanged || loading || !data || data.total === 0}
        appliedChips={appliedChips}
      />

      {draftChanged && (
        <p className="text-xs text-warn-text">筛选条件已修改，请点击「查询」以应用。</p>
      )}

      <Panel title="支付订单" note="本页不提供退款；退款请到订单管理">
        {/* 刷新失败但手上还有上一次的数据：只挂提示，不把整个列表藏起来 */}
        {error && data && <StaleError error={error} onRetry={() => void reload()} />}
        <AdminDataTable
          rows={rows}
          columns={columns}
          rowKey={(row) => row.id}
          loading={loading}
          error={data ? null : error}
          onRetry={() => void reload()}
          emptyText={hasFilter ? '没有匹配的支付订单，清除筛选后再试' : '还没有支付订单'}
          emptyAction={
            hasFilter ? (
              <ActionButton variant="secondary" size="sm" onClick={resetFilters}>
                清除筛选
              </ActionButton>
            ) : undefined
          }
          minWidth={1040}
          onRowClick={(row) => setDetailId(row.id)}
          pagination={{
            current: data?.page ?? 1,
            pageSize: data?.pageSize ?? 30,
            total: data?.total ?? 0,
            onChange: (page, pageSize) => setPage(page, pageSize),
          }}
        />
      </Panel>

      <ConfirmDialog
        open={action !== null}
        danger={action?.kind === 'close'}
        title={action?.kind === 'close' ? '关闭支付订单' : '向渠道同步订单状态'}
        description={
          action?.kind === 'close'
            ? '关闭后该订单不再等待支付。已支付的订单不会被关闭，请先同步状态确认。'
            : '向渠道查一次订单状态；若渠道已收款，会立即入账并补发积分。'
        }
        impact={
          action?.kind === 'close'
            ? ['未支付订单将标记为已关闭', '已支付订单会被拒绝关闭，请先同步状态', '关闭不会退款']
            : ['若渠道已收款，积分会立即入账']
        }
        confirmText={action?.kind === 'close' ? '确认关闭' : '确认同步'}
        loading={busy}
        onCancel={() => setAction(null)}
        onConfirm={async () => {
          if (!action) return;
          setBusy(true);
          try {
            if (action.kind === 'query') {
              await adminPaymentOrdersApi.query(action.order.id);
              toast.success('已同步渠道状态');
            } else {
              await adminPaymentOrdersApi.close(action.order.id);
              toast.success('订单已关闭');
            }
            setAction(null);
            reload();
          } catch (e) {
            toast.error(e instanceof Error ? e.message : '操作失败');
          } finally {
            setBusy(false);
          }
        }}
      />

      {detailId && (
        <PaymentOrderDetailDrawer
          orderId={detailId}
          onClose={() => setDetailId(null)}
          onChanged={reload}
        />
      )}
    </div>
  );
}
