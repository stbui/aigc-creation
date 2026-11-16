/**
 * 存储配置的纯函数与外部工具入口 —— 目录内文件的唯一外部工具来源。
 * 新增引用时在这里补一行 re-export。
 */

import { BACKEND_ORDER, KIND_LABEL, KIND_ORDER, META } from './constants';
import type { AdminAssetStats, DistributionRow } from './types';

export { cn } from '~/admin-ui/lib/cn';
export { formatBytes, formatNumber } from '../../../admin-ui/lib/format';

/**
 * 容量分布的两组行：后端按固定顺序，素材来源先按已知顺序、再补未知值（原样显示，
 * 不静默丢弃）。占比按**条数**算 —— 素材域只下发按条数的分组，没有分后端字节汇总。
 */
export function buildDistributionRows(stats: AdminAssetStats) {
  const backendRows: DistributionRow[] = BACKEND_ORDER.map((backend) => ({
    key: backend,
    label: META[backend].label,
    count: stats.byBackend[backend] ?? 0,
  }));
  const kindRows: DistributionRow[] = [
    ...KIND_ORDER.map((kind) => ({
      key: kind,
      label: KIND_LABEL[kind],
      count: stats.byKind[kind] ?? 0,
    })),
    ...Object.keys(stats.byKind ?? {})
      .filter((kind) => !KIND_ORDER.includes(kind))
      .map((kind) => ({ key: kind, label: kind, count: stats.byKind[kind] ?? 0 })),
  ];
  return { backendRows, kindRows };
}
