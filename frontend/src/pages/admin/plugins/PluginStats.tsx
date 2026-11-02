import { StatCard } from './components';
import type { PluginListResult } from '../../../types/model';

/**
 * 插件概览统计。
 *
 * 「已注册协议」与「当前环境不可用」是排障的第一眼指标：前者为 0 说明
 * 注册表是空的，后者非 0 说明清单入库了但本环境不会执行它。
 */
export function PluginStats({
  summary,
  unavailableCount,
}: {
  summary: NonNullable<PluginListResult['summary']> | undefined;
  unavailableCount: number;
}) {
  if (!summary) return null;

  return (
    <div className="mb-3 grid grid-cols-4 gap-3">
      <StatCard
        label="插件总数"
        value={summary.total}
        hint={`启用 ${summary.enabled} · 停用 ${summary.disabled}`}
      />
      <StatCard label="Provider" value={summary.providers} hint="跨插件汇总" />
      <StatCard
        label="已注册协议"
        value={summary.protocol.registered}
        hint={
          summary.protocol.hostBacked.length > 0
            ? `宿主引擎未内置 ${summary.protocol.hostBacked.length} 个`
            : '声明式插件全部注册'
        }
        tone={summary.protocol.registered === 0 ? 'danger' : undefined}
      />
      <StatCard
        label="当前环境不可用"
        value={unavailableCount}
        hint={
          unavailableCount > 0
            ? '清单已入库，但本环境不执行其贡献'
            : '全部插件在本环境可用'
        }
        tone={unavailableCount > 0 ? 'warn' : undefined}
      />
    </div>
  );
}
