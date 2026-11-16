import { Meter, Notice, Panel, StatCards } from './components';
import { META } from './constants';
import type { AdminAssetStats, DistributionRow, StorageBackendId } from './types';
import { buildDistributionRows, formatBytes, formatNumber } from './utils';

/**
 * 占比条按**条数**算：素材域只下发按条数的分组，没有分后端的字节汇总。
 * 字节总量放在上方统计卡里，不在这里用条数反推一个假字节数。
 */
function Distribution({
  title,
  rows,
  total,
}: {
  title: string;
  rows: DistributionRow[];
  total: number;
}) {
  return (
    <div className="min-w-0">
      <div className="mb-2 text-[13px] font-medium text-foreground">{title}</div>
      <div className="flex flex-col gap-2.5">
        {rows.map((row) => {
          const percent = total > 0 ? (row.count / total) * 100 : 0;
          return (
            <div key={row.key} data-testid="admin-storage-dist-row" data-key={row.key}>
              <div className="flex items-baseline justify-between gap-2 text-[12px] leading-4">
                <span className="truncate text-foreground">{row.label}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {formatNumber(row.count)} 个 · {Math.round(percent)}%
                </span>
              </div>
              <Meter className="mt-1.5" value={percent} decorative />
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * 容量概览：统计卡 + 按后端 / 来源的占比分布。
 *
 * 数据源是素材域 `GET /admin/assets/stats`，与「素材管理」页同源；
 * 无 asset.read 时 stats 为 null，只保留后端状态与连通性测试。
 */
export function StorageCapacitySection({
  stats,
  active,
}: {
  stats: AdminAssetStats | null;
  active: StorageBackendId;
}) {
  if (!stats) {
    return (
      <div className="mt-4">
        <Notice tone="info" title="容量统计需要素材读取权限。">
          <p>当前账号没有 asset.read，已隐藏容量概览；后端状态与连通性测试不受影响。</p>
        </Notice>
      </div>
    );
  }

  const hiddenCount = stats.byStatus.hidden ?? 0;
  const { backendRows, kindRows } = buildDistributionRows(stats);

  return (
    <>
      <StatCards
        className="mt-4 mb-4"
        columns={4}
        items={[
          {
            key: 'bytes',
            label: '已占用容量',
            value: formatBytes(stats.totalBytes),
            hint: `${formatNumber(stats.total)} 个素材文件`,
          },
          {
            key: 'assets',
            label: '素材总数',
            value: formatNumber(stats.total),
            hint:
              stats.total > 0
                ? `平均 ${formatBytes(stats.totalBytes / stats.total)} / 个`
                : '暂无素材',
          },
          {
            key: 'active',
            label: '当前默认后端',
            value: META[active]?.label ?? active,
            hint: '只影响新上传',
          },
          {
            key: 'hidden',
            label: '已下架仍占用',
            value: formatNumber(hiddenCount),
            hint: '下架不删除文件',
            tone: hiddenCount > 0 ? 'warn' : undefined,
          },
        ]}
      />

      <Panel
        title="容量分布"
        note="按素材记录统计，与「素材管理」页同源；不含未入库的孤儿文件"
      >
        <div className="grid gap-5 [grid-template-columns:repeat(auto-fit,minmax(240px,1fr))]">
          <Distribution title="按存储后端" rows={backendRows} total={stats.total} />
          <Distribution title="按素材来源" rows={kindRows} total={stats.total} />
        </div>
        <p className="mt-3 border-t border-border pt-3 text-[12px] leading-5 text-muted-foreground">
          每条素材记录写入时的 <code className="font-mono">storageBackend</code>
          ，切换默认后端不会改变已有素材的读取位置。
        </p>
      </Panel>
    </>
  );
}
