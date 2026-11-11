import { useCallback, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { adminModelCallsHref, defaultRange } from './utils';
import { useAdminResource, useAdminUrlFilterSync } from './hooks';
import { adminAnalyticsApi } from '../../../lib/api';
import {
  AdminPage,
  ActionButton,
  RefreshButton,
  AdminDataTable,
  FilterActions,
  FilterBar,
  Panel,
  StatCards,
  TextField,
  type AdminColumn,
} from '~/admin-ui/primitives';
import { toCredits } from '../../../lib/microcredits';
import type { FinanceAnalyticsView, FinanceBreakdownRow, FinanceDayRow } from '../../../types/model';

/**
 * 财务分析（`/admin/finance`）。
 *
 * 口径固定为三条，页面文案与后端 `FinanceAnalyticsService` 顶部说明必须一致：
 *   · 实收 = 已结算账单的实际金额；
 *   · 已退 = 除「线路切换」外的退款金额（换线退款只是把预授权挪到新线路，
 *     钱没有离开平台，用户也没拿回积分）；
 *   · 净收入 = 实收 - 已退。
 * 预留 / 运行 / 待核对单列为「挂账」，**不计入实收** —— 把不确定的钱算成收入
 * 是财务页最不能犯的错，页面上宁可多一列也不合并。
 *
 * 单位是**积分**（内部计价单位），与概览页「订单收入（元）」不是同一笔账：
 * 概览看订单实付（元），这里看已结算账单（积分）。同名不同义，页面标题与
 * 页头说明都带单位，避免两处数字被当成同一个数去对账。
 */

export function AdminFinancePage() {
  /*
   * 初始区间优先读地址栏：分享出去的「看某月实收」链接必须能还原同一区间，
   * 读不到才回落近 30 天。日期格式是 `YYYY-MM-DD`，其它值一律忽略。
   */
  const [searchParams] = useSearchParams();
  const initial = useMemo(() => {
    const fallback = defaultRange();
    const fromParam = searchParams.get('from');
    const toParam = searchParams.get('to');
    const isDate = (value: string | null): value is string => Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
    return {
      from: isDate(fromParam) ? fromParam : fallback.from,
      to: isDate(toParam) ? toParam : fallback.to,
    };
  }, [searchParams]);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  /** 已生效的区间：输入框改动不触发请求，点「查询」才生效 */
  const [applied, setApplied] = useState(initial);

  /*
   * 区间写回地址栏：财务页的区间是唯一筛选条件，不写回就没法把「看某月的
   * 实收」这件事分享出去，刷新也回到近 30 天。只写回已生效的区间 ——
   * 输入框里还没点查询的日期不进 URL。
   */
  useAdminUrlFilterSync({ from: applied.from, to: applied.to });

  const fetcher = useCallback(
    () => adminAnalyticsApi.finance({ from: applied.from, to: applied.to }),
    [applied.from, applied.to],
  );
  const { data, loading, error, reload } = useAdminResource<FinanceAnalyticsView>(fetcher, [applied.from, applied.to]);
  const totals = data?.totals;

  const apply = () => setApplied({ from, to });
  const reset = () => {
    const next = defaultRange();
    setFrom(next.from);
    setTo(next.to);
    setApplied(next);
  };

  const dayColumns: Array<AdminColumn<FinanceDayRow>> = [
    {
      key: 'date',
      title: '日期',
      width: 120,
      render: (row) => <span className="font-mono text-[12px]">{row.date}</span>,
    },
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
      render: (row) => <span className="tabular-nums text-warn-text">{toCredits(row.refundedMicrocredits)}</span>,
    },
    {
      key: 'net',
      title: '净收入（积分）',
      width: 140,
      align: 'right',
      render: (row) => <span className="tabular-nums font-medium">{toCredits(row.netMicrocredits)}</span>,
    },
  ];

  /**
   * 明细行。`linkOf` 给「按模型 / 按渠道」挂下钻：看到某个渠道成本异常，
   * 下一步一定是去调用记录看具体请求，而不是自己抄渠道 id 再手填筛选。
   * 汇总里的哨兵值（`(无渠道)` / `(未命名模型)`）不是真实编码，不给入口。
   */
  const breakdownColumns = (
    label: string,
    linkOf?: (row: FinanceBreakdownRow) => string | null,
  ): Array<AdminColumn<FinanceBreakdownRow>> => [
    {
      key: 'label',
      title: label,
      render: (row) => {
        const href = linkOf?.(row) ?? null;
        if (!href) {
          return <span className="font-mono text-[12px] text-foreground">{row.label || '—'}</span>;
        }
        return (
          <Link className="font-mono text-[12px] text-brand hover:underline" to={href}>
            {row.label || '—'}
          </Link>
        );
      },
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
    linkOf?: (row: FinanceBreakdownRow) => string | null,
  ) => (
    <Panel title={title} note={note}>
      <AdminDataTable<FinanceBreakdownRow>
        rows={rows ?? []}
        columns={breakdownColumns(label, linkOf)}
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
    <AdminPage
      title="财务分析"
      description="按账单口径汇总：实收只算已结算，挂账单列。金额单位为积分，保留 6 位小数。与概览页的「订单收入（元）」不是同一笔账。"
      actions={<RefreshButton loading={loading} onRefresh={reload} />}
    >

      <StatCards
        columns={6}
        className="mb-3"
        items={[
          { label: '实收（积分）', value: toCredits(totals?.chargedMicrocredits ?? 0) },
          {
            label: '已退（积分）',
            value: toCredits(totals?.refundedMicrocredits ?? 0),
            tone: 'warn',
          },
          { label: '净收入（积分）', value: toCredits(totals?.netMicrocredits ?? 0) },
          {
            label: '挂账（积分）',
            value: toCredits(totals?.outstandingMicrocredits ?? 0),
            hint: '预留 / 运行 / 待核对，不计入实收',
            tone: (totals?.uncertainOrders ?? 0) > 0 ? 'danger' : undefined,
          },
          {
            label: '订单数',
            value: totals?.orders ?? 0,
            hint: `结算成功率 ${((totals?.settleRate ?? 0) * 100).toFixed(1)}%`,
          },
          {
            label: '成本（积分）',
            value: toCredits(totals?.costMicrocredits ?? 0),
            hint: `毛利 ${toCredits(totals?.marginMicrocredits ?? 0)}`,
          },
        ]}
      />

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
        {breakdownPanel(
          '按模型',
          '取订单数前 10 · 点模型名查看该模型的上游调用',
          data?.byModel,
          '模型',
          (row) => (row.label === '(未命名模型)' ? null : adminModelCallsHref({ model: row.key })),
        )}
        {breakdownPanel(
          '按渠道',
          '取订单数前 10 · 点渠道 id 查看该渠道的上游调用',
          data?.byChannel,
          '渠道',
          (row) => (row.label === '(无渠道)' ? null : adminModelCallsHref({ channelId: row.key })),
        )}
        {breakdownPanel('按能力', '取订单数前 10', data?.byCapability, '能力')}
        {breakdownPanel('按场景', '取订单数前 10', data?.byScene, '场景')}
      </div>
    </AdminPage>
  );
}
