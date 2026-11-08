import type { ReactNode } from 'react';
import type { AdminOverview } from '../../../types/api';
import { yuan } from './utils';

/**
 * 窗口指标带。
 *
 * 一行读数 + 环比，替代六张同权重指标卡：数值与「比上一窗口好还是坏」
 * 挨在一起，扫一眼就有判断。
 */
export function WindowStrip({ data, isFinance }: { data: AdminOverview; isFinance: boolean }) {
  const w = data.window;
  const cmp = data.comparison;

  const items: Array<{
    key: string;
    label: string;
    value: string;
    delta: ReactNode;
    hint: string;
    danger?: boolean;
  }> = [
    ...(isFinance
      ? []
      : [
          {
            key: 'tasks',
            label: '任务量',
            value: w.tasks.toLocaleString('zh-CN'),
            delta: <Delta current={w.tasks} previous={cmp.tasks} />,
            hint: `上一窗口 ${cmp.tasks}`,
          },
          {
            key: 'rate',
            label: '成功率',
            value: w.successRate === null ? '—' : `${w.successRate}%`,
            delta: <Delta current={w.successRate} previous={cmp.successRate} unit="pp" />,
            hint: `失败 ${w.failed} 条`,
            danger: w.successRate !== null && w.successRate < 90,
          },
        ]),
    {
      key: 'users',
      label: '新增用户',
      value: w.revenue.usersNew.toLocaleString('zh-CN'),
      delta: <Delta current={w.revenue.usersNew} previous={cmp.usersNew} />,
      hint: `上一窗口 ${cmp.usersNew}`,
    },
    {
      key: 'gmv',
      label: '营收',
      value: `¥${yuan(w.revenue.gmvCents)}`,
      delta: <Delta current={w.revenue.gmvCents} previous={cmp.gmvCents} />,
      hint: `上一窗口 ¥${yuan(cmp.gmvCents, 0)}`,
    },
    {
      key: 'paid',
      label: '支付订单',
      value: w.revenue.paidOrders.toLocaleString('zh-CN'),
      delta: <Delta current={w.revenue.paidOrders} previous={cmp.paidOrders} />,
      hint: `上一窗口 ${cmp.paidOrders}`,
    },
    {
      key: 'refund',
      label: '退款',
      value: `¥${yuan(w.revenue.refundedCents)}`,
      delta: <Delta current={w.revenue.refundedCents} previous={cmp.refundedCents} inverse />,
      hint: `上一窗口 ¥${yuan(cmp.refundedCents, 0)}`,
      danger: w.revenue.refundedCents > 0,
    },
  ];

  return (
    <dl className="m-0 grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-x-0 gap-y-3.5">
      {items.map((item, index) => (
        <div
          key={item.key}
          className={
            index === 0
              ? 'min-w-0 px-4 pl-0'
              : 'min-w-0 border-l border-border px-4'
          }
        >
          <dt className="mb-1.5 text-[12px] text-muted-foreground">{item.label}</dt>
          <dd className="flex items-baseline gap-1.5">
            <span
              className={
                item.danger
                  ? 'text-xl leading-6 font-semibold tracking-tight text-danger-text'
                  : 'text-xl leading-6 font-semibold tracking-tight text-foreground'
              }
            >
              {item.value}
            </span>
            <span className="text-[12px]">{item.delta}</span>
          </dd>
          <span className="mt-0.5 block text-[12px] text-muted-foreground">{item.hint}</span>
        </div>
      ))}
    </dl>
  );
}

/**
 * 累计规模。
 *
 * `totals` 一直是全量口径，不随页头的时间窗变化；它解决的是「平台现在有
 * 多少用户 / 项目 / 素材」这类存量问题。任务状态与累计成功率只给有任务读权
 * 的运营视角；财务视角用累计实收补位，避免与上方窗口营收混淆。
 */
export function TotalsStrip({ data, isFinance }: { data: AdminOverview; isFinance: boolean }) {
  const t = data.totals;
  const items: Array<{
    key: string;
    label: string;
    value: string;
    hint: string;
    danger?: boolean;
  }> = [
    {
      key: 'users',
      label: '用户总数',
      value: t.users.toLocaleString('zh-CN'),
      hint: `近 ${data.days} 天新增 ${t.newUsers.toLocaleString('zh-CN')}`,
    },
    {
      key: 'projects',
      label: '项目总数',
      value: t.projects.toLocaleString('zh-CN'),
      hint: '平台全部项目',
    },
    ...(isFinance
      ? [
          {
            key: 'gmv',
            label: '累计实收',
            value: `¥${yuan(data.commerce.gmvCents)}`,
            hint: `${data.commerce.orders.paid.toLocaleString('zh-CN')} 笔已支付订单`,
          },
        ]
      : [
          {
            key: 'tasks',
            label: '任务总数',
            value: t.tasks.toLocaleString('zh-CN'),
            hint: `运行中 ${t.running.toLocaleString('zh-CN')} · 排队 ${t.queued.toLocaleString('zh-CN')}`,
          },
          {
            key: 'success',
            label: '累计成功率',
            value: t.successRate === null ? '—' : `${t.successRate}%`,
            hint: `成功 ${t.succeeded.toLocaleString('zh-CN')} · 失败 ${t.failed.toLocaleString('zh-CN')}`,
            danger: t.successRate !== null && t.successRate < 90,
          },
        ]),
    {
      key: 'assets',
      label: '素材总量',
      value: t.assets.toLocaleString('zh-CN'),
      hint: `原始 ${t.originals.toLocaleString('zh-CN')} · 生成 ${t.generated.toLocaleString('zh-CN')}`,
    },
  ];

  return (
    <dl
      data-testid="admin-overview-totals"
      className="m-0 grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-x-0 gap-y-3.5"
    >
      {items.map((item, index) => (
        <div
          key={item.key}
          className={index === 0 ? 'min-w-0 px-4 pl-0' : 'min-w-0 border-l border-border px-4'}
        >
          <dt className="mb-1.5 text-[12px] text-muted-foreground">{item.label}</dt>
          <dd
            className={
              item.danger
                ? 'text-xl leading-6 font-semibold tracking-tight text-danger-text tabular-nums'
                : 'text-xl leading-6 font-semibold tracking-tight text-foreground tabular-nums'
            }
          >
            {item.value}
          </dd>
          <span className="mt-0.5 block text-[12px] text-muted-foreground">{item.hint}</span>
        </div>
      ))}
    </dl>
  );
}

function Delta({
  current,
  previous,
  unit = 'percent',
  inverse = false,
}: {
  current: number | null;
  previous: number | null;
  unit?: 'percent' | 'pp';
  inverse?: boolean;
}) {
  if (current === null || previous === null) {
    return <span className="font-medium text-muted-foreground tabular-nums">—</span>;
  }
  if (previous === 0) {
    return current === 0 ? (
      <span className="font-medium text-muted-foreground tabular-nums">持平</span>
    ) : (
      <span
        className={
          inverse
            ? 'font-medium text-danger-text tabular-nums'
            : 'font-medium text-success-text tabular-nums'
        }
      >
        {current > 0 ? '新增' : '—'}
      </span>
    );
  }

  const diff = unit === 'pp' ? current - previous : ((current - previous) / Math.abs(previous)) * 100;
  if (Math.abs(diff) < 0.05) {
    return <span className="font-medium text-muted-foreground tabular-nums">持平</span>;
  }

  const up = diff > 0;
  const good = inverse ? !up : up;
  return (
    <span
      className={
        good
          ? 'font-medium text-success-text tabular-nums'
          : 'font-medium text-danger-text tabular-nums'
      }
    >
      {up ? '↑' : '↓'}
      {unit === 'pp' ? `${Math.abs(diff).toFixed(1)}pp` : `${Math.abs(diff).toFixed(0)}%`}
    </span>
  );
}
