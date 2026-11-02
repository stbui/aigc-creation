import { HardDrive } from 'lucide-react';
import { StatCard } from './components';
import { BACKEND_LABEL } from './constants';
import type { AdminAssetStats } from '../../../types/api';

/**
 * 素材概览统计卡。
 *
 * 统计失败时整块不渲染（不显示 0）—— 「0 张素材」与「统计没取到」是两回事，
 * 前者会让运营误以为库里空了。
 */
export function AssetStats({ stats }: { stats: AdminAssetStats }) {
  return (
    <div className="mb-3 grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(180px,1fr))]">
      <StatCard label="素材总量" value={stats.total} hint={`共 ${stats.totalMb} MB`} />
      <StatCard
        label="已下架"
        value={stats.byStatus.hidden ?? 0}
        hint="用户端不可见"
        tone={(stats.byStatus.hidden ?? 0) > 0 ? 'warn' : undefined}
      />
      <StatCard
        label="生成图"
        value={stats.byKind.generated ?? 0}
        hint={`原始上传 ${stats.byKind.original ?? 0}`}
      />
      <StatCard
        label="存储分布"
        value={
          <span className="flex items-center gap-1.5 text-[15px] leading-6">
            <HardDrive className="size-4 text-muted-foreground" aria-hidden />
            {Object.entries(stats.byBackend)
              .map(([k, v]) => `${BACKEND_LABEL[k] ?? k} ${v}`)
              .join(' · ') || '—'}
          </span>
        }
        hint="按写入时后端统计，切换后端不迁移既有文件"
      />
    </div>
  );
}
