import { useCallback, useState } from 'react';
import { adminAnalyticsApi } from '../../lib/api';
import {
  ActionButton,
  AdminDataTable,
  FilterActions,
  FilterBar,
  PageHeader,
  Panel,
  StatCard,
  TextField,
  useAdminResource,
  type AdminColumn,
} from '../../admin-ui/primitives';
import { toCredits } from '../../lib/microcredits';
import type { FinanceAnalyticsView, FinanceBreakdownRow, FinanceDayRow } from '../../types/model';

/**
 * 财务分析（`/admin/finance`）。
 *
 * 口径固定为三条，页面文案与后端 `FinanceAnalyticsService` 顶部说明必须一致：
 *   · 实收 = 已结算账单的实际金额；
 *   · 已退 = 全部订单的退款金额；
 *   · 净收入 = 实收 - 已退。
 * 预留 / 运行 / 待核对单列为「挂账」，**不计入实收** —— 把不确定的钱算成收入
 * 是财务页最不能犯的错，页面上宁可多一列也不合并。
 */

/** 默认区间：最近 30 天（与后端默认一致，避免首屏与刷新后口径不同） */
function defaultRange(): { from: string; to: string } {
  const today = new Date();
  const start = new Date(today.getTime() - 29 * 24 * 60 * 60 * 1000);
  return { from: isoDate(start), to: isoDate(today) };
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function AdminFinancePage() {
  const initial = defaultRange();
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  /** 已生效的区间：输入框改动不触发请求，点「查询」才生效 */
  const [applied, setApplied] = useState(initial);

  const fetcher = useCallback(
    () => adminAnalyticsApi.finance({ from: applied.from, to: applied.to }),
    [applied.from, applied.to],
  );
  const { data, loading, error, reload } = useAdminResource<FinanceAnalyticsView>(fetcher, [
    applied.from,
    applied.to,
  ]);
  const totals = data?.totals;

  const apply = () => setApplied({ from, to });
  const reset = () => {
    const next = defaultRange();
    setFrom(next.from);
    setTo(next.to);
    setApplied(next);
  };

  const dayColumns: Array<AdminColumn<FinanceDayRow>> = [
    { key: 'date', title: '日期', width: 120, render: (row) => <span className="font-mono text-[11px]">{row.date}</span> },
    { key: 'orders', title: '订单', width: 90, align: 'right', render: (row) => row.orders },
    {
      key: 'settled',
      title: '已结算',
      width: 110,
      align: 'right',
      render: (row) => <span className="tabular-nums">{row.settledOrders}</span>,
    },
    {
      key: 'refunded',
      title: '已退款',
      width: 110,
      align: 'right',
      render: (row) => <span className="tabular-nums">{row.refundedOrders}</span>,
    },
    {
      key: 'charged',
      title: '实收（积分）',
      width: 130,
      align: 'right',
      render: (row) => <span className="tabular-nums text-foreground">{toCredits(row.chargedMicrocredits)}</span>,
    },
    {
      key: 'refundedAmount',
      title: '已退（积分）',
      width: 130,
      align: 'right',
      render: (row) => (
        <span className="tabular-nums text-warn-text">{toCredits(row.refundedMicrocredits)}</span>
      ),
    },
    {
      key: 'net',
      title: '净收入（积分）',
      width: 140,
      align: 'right',
      render: (row) => <span className="tabular-nums font-medium">{toCredits(row.netMicrocredits)}</span>,
    },
  ];

  const breakdownColumns = (label: string): Array<AdminColumn<FinanceBreakdownRow>> => [
    {
      key: 'label',
      title: label,
      render: (row) => <span className="font-mono text-[11px] text-foreground">{row.label || '—'}</span>,
    },
    { key: 'orders', title: '订单', width: 80, align: 'right', render: (row) => row.orders },
    {
      key: 'settledOrders',
      title: '已结算',
      width: 90,
      align: 'right',
      render: (row) => <span className="tabular-nums">{row.settledOrders}</span>,
    },
    {
      key: 'refundedOrders',
      title: '已退款',
      width: 90,
      align: 'right',
      render: (row) => <span className="tabular-nums">{row.refundedOrders}</span>,
    },
    {
      key: 'charged',
      title: '实收（积分）',
      width: 130,
      align: 'right',
      render: (row) => <span className="tabular-nums">{toCredits(row.chargedMicrocredits)}</span>,
    },
    {
      key: 'net',
      title: '净收入（积分）',
      width: 140,
      align: 'right',
      render: (row) => <span className="tabular-nums font-medium">{toCredits(row.netMicrocredits)}</span>,
    },
  ];

  /*
   * 刷新失败时 `useAdminResource` 保留上一次数据：有数据就只在上方给一条
   * 「已失效」提示，不要把整页清空 —— 财务页清空会被误读成「收入归零」。
   */
  const tableError = (hasRows: boolean) => (hasRows ? null : error);

  const breakdownPanel = (
    title: string,
    note: string,
    rows: FinanceBreakdownRow[] | undefined,
    label: string,
  ) => (
    <Panel title={title} note={note}>
      <AdminDataTable<FinanceBreakdownRow>
        rows={rows ?? []}
        columns={breakdownColumns(label)}
        rowKey={(row) => row.key}
        loading={loading}
        error={tableError((rows?.length ?? 0) > 0)}
        onRetry={() => void reload()}
        emptyText="该区间没有账单"
        minWidth={760}
      />
    </Panel>
  );

  return (
    <>
      <PageHeader
        title="财务分析"
        description="按账单口径汇总：实收只算已结算，挂账单列。金额单位为积分，保留 6 位小数。"
        actions={
          <ActionButton variant="secondary" size="sm" onClick={() => void reload()} disabled={loading}>
            刷新
          </ActionButton>
        }
      />

      <div className="mb-3 grid grid-cols-6 gap-3">
        <StatCard label="实收（积分）" value={toCredits(totals?.chargedMicrocredits ?? 0)} />
        <StatCard label="已退（积分）" value={toCredits(totals?.refundedMicrocredits ?? 0)} tone="warn" />
        <StatCard label="净收入（积分）" value={toCredits(totals?.netMicrocredits ?? 0)} />
        <StatCard
          label="挂账（积分）"
          value={toCredits(totals?.outstandingMicrocredits ?? 0)}
          hint="预留 / 运行 / 待核对，不计入实收"
          tone={(totals?.uncertainOrders ?? 0) > 0 ? 'danger' : undefined}
        />
        <StatCard label="订单数" value={totals?.orders ?? 0} hint={`结算成功率 ${((totals?.settleRate ?? 0) * 100).toFixed(1)}%`} />
        <StatCard
          label="成本（积分）"
          value={toCredits(totals?.costMicrocredits ?? 0)}
          hint={`毛利 ${toCredits(totals?.marginMicrocredits ?? 0)}`}
        />
      </div>

      <Panel
        title="区间与趋势"
        note={
          data
            ? `${data.range.from.slice(0, 10)} 至 ${data.range.to.slice(0, 10)}，共 ${data.range.days} 天`
            : '按日汇总的实收 / 已退 / 净收入'
        }
      >
        <FilterBar>
          <TextField ariaLabel="开始日期" type="date" value={from} onChange={setFrom} />
          <TextField ariaLabel="结束日期" type="date" value={to} onChange={setTo} />
          <FilterActions>
            <ActionButton onClick={apply} disabled={loading}>
              查询
            </ActionButton>
            <ActionButton variant="secondary" size="sm" onClick={reset}>
              近 30 天
            </ActionButton>
          </FilterActions>
        </FilterBar>
        <AdminDataTable<FinanceDayRow>
          rows={data?.byDay ?? []}
          columns={dayColumns}
          rowKey={(row) => row.date}
          loading={loading}
          error={null}
          emptyText="该区间没有账单"
          minWidth={880}
        />
      </Panel>

      <div className="mt-3 grid grid-cols-2 gap-3">
        {breakdownPanel('按模型', '取订单数前 10', data?.byModel, '模型')}
        {breakdownPanel('按渠道', '取订单数前 10', data?.byChannel, '渠道')}
        {breakdownPanel('按能力', '取订单数前 10', data?.byCapability, '能力')}
        {breakdownPanel('按场景', '取订单数前 10', data?.byScene, '场景')}
      </div>
    </>
  );
}
