import { useMemo } from 'react';
import { StatCard } from '~/admin-ui/primitives';
import type { AdminProduct } from '../../../types/api';

/** 商品统计条：总数 / 在售 / 已下架 / 促销中 */
export function ProductStats({ rows }: { rows: AdminProduct[] }) {
  const stats = useMemo(() => {
    const active = rows.filter((p) => p.status === 'active');
    const offline = rows.length - active.length;
    const discounted = rows.filter(
      (p) => p.originalPriceCents !== null && p.originalPriceCents > p.priceCents,
    ).length;
    return { active: active.length, offline, discounted };
  }, [rows]);

  return (
    <div className="mb-3 grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(180px,1fr))]">
      <StatCard label="商品总数" value={rows.length} hint="含已下架，均可被历史订单引用" />
      <StatCard label="在售" value={stats.active} hint="C 端可下单" />
      <StatCard label="已下架" value={stats.offline} hint="不可下单，历史订单不受影响" />
      <StatCard
        label="促销中"
        value={stats.discounted}
        hint="划线价高于售价的商品数量"
        tone={stats.discounted > 0 ? 'warn' : undefined}
      />
    </div>
  );
}
