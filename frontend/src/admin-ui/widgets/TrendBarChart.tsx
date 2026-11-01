import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { cn } from '../lib/cn';

/**
 * 柱状趋势图。
 *
 * ## 为什么换掉手写 SVG 版
 *
 * 原实现（`AdminDashboardPage` 里的 `TrendChart`）用 flex + 内联高度画柱子，
 * 有三个绕不过去的问题：
 *   1. 柱子只能贴着容器底往上长，**Y 轴刻度是假的**（网格线写死 5 条等距，
 *      与实际峰值无关）；
 *   2. 数值标签恒定贴在柱顶上方 18px，柱子矮时会撞到网格线；
 *   3. 峰值变化时所有柱子的比例关系只能靠眼睛估，没有真实坐标轴。
 *
 * Recharts 给的是真坐标轴，Y 轴按峰值自动分档，且配色走项目令牌。
 *
 * ## 配色
 *
 * 柱子用 `var(--brand)`（品牌紫），有失败的那天用 `var(--danger-text)`。
 * 不用 Recharts 默认色板：默认的 `#3182bd` 之类是库的调色板，与全站紫系
 * 无关，且暗色下会整块变色。
 */
export function TrendBarChart({
  items,
  ariaLabel,
  empty,
  className,
  height = 160,
  valueFormatter,
}: {
  items: Array<{
    key: string;
    date: string;
    value: number;
    title: string;
    warn?: boolean;
  }>;
  ariaLabel: string;
  empty: string;
  className?: string;
  height?: number;
  /** 数值格式化（收入趋势要显示「¥1,234」，任务量显示整数） */
  valueFormatter?: (value: number) => string;
}) {
  if (items.every((item) => item.value === 0)) {
    return <div className={cn('py-8 text-center text-xs text-muted-foreground', className)}>{empty}</div>;
  }

  const format = valueFormatter ?? ((value: number) => String(value));

  return (
    <div
      className={cn('w-full', className)}
      // Recharts 的 SVG 自身没有 role，图级语义挂在外层容器上
      role="img"
      aria-label={ariaLabel}
    >
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={items} margin={{ top: 16, right: 4, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
          <XAxis
            dataKey="date"
            tickLine={false}
            axisLine={false}
            tick={{ fill: 'var(--text-desc)', fontSize: 11 }}
            tickFormatter={(value: string) => value.slice(5).replace('-', '/')}
            interval="preserveStartEnd"
            minTickGap={16}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={44}
            tick={{ fill: 'var(--text-desc)', fontSize: 11 }}
            tickFormatter={format}
          />
          <Tooltip
            cursor={{ fill: 'var(--surface)', opacity: 0.6 }}
            contentStyle={{
              background: 'var(--card-bg)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-control)',
              fontSize: 12,
              padding: '6px 10px',
              boxShadow: 'var(--shadow-card)',
            }}
            labelStyle={{ color: 'var(--text-muted)', marginBottom: 2 }}
            itemStyle={{ color: 'var(--text-strong)' }}
            formatter={(value) => [format(Number(value)), '']}
          />
          <Bar
            dataKey="value"
            radius={[4, 4, 0, 0]}
            maxBarSize={30}
            /*
             * 关掉入场动画。
             *
             * Recharts 默认 1500ms 从零长起。后台概览每 30 秒自动刷新一次，
             * 每次刷新柱子都重新「长」一遍 —— 盯着看是在看动画，不是看数据。
             * 截图工具也会在这段时间里拍到空图（柱子是空的，轴还在）。
             */
            isAnimationActive={false}
          >
            {items.map((item) => (
              <Cell
                key={item.key}
                fill={item.warn ? 'var(--danger-text)' : 'var(--brand)'}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
