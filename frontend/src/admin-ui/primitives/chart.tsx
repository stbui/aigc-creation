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
 * ## 为什么用 Recharts 而不是手写 SVG
 *
 * 手写 flex 柱子的三个硬伤：Y 轴刻度是假的（网格线写死等距，与实际峰值无关）、
 * 数值标签位置固定（柱子矮时撞网格线）、峰值变化后比例只能靠眼睛估。
 * Recharts 给真坐标轴，并按峰值自动分档。
 *
 * ## 配色
 *
 * 柱子用 `var(--brand)`，有失败的那天用 `var(--danger-text)`。不用 Recharts
 * 默认色板 —— 默认的蓝色与全站紫系无关。所有颜色都引用令牌，不写裸 hex。
 *
 * ## 关掉入场动画
 *
 * 概览每 30 秒自动刷新一次，默认 1500ms 的生长动画会让每次刷新都重播一遍，
 * 盯着看的是动画而不是数据；截图工具也会在动画期间拍到空图。
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
    return (
      <div className={cn('py-8 text-center text-xs text-muted-foreground', className)}>{empty}</div>
    );
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
          <Bar dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={30} isAnimationActive={false}>
            {items.map((item) => (
              <Cell key={item.key} fill={item.warn ? 'var(--danger-text)' : 'var(--brand)'} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
