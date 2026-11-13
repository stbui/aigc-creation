import { useNavigate } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';

import { STATS_PAGE_META } from './constants';
import { Button, PersonalPage, StateEmpty, StateError, StateSkeleton } from './components';
import { useAuth, useDocumentMeta, useStatsOverview } from './hooks';
import { formatUpdatedAt, trendSummaryOf } from './utils';
import { StatsCapabilityPanel } from './StatsCapabilityPanel';
import { StatsEmptyPanel } from './StatsEmptyPanel';
import { StatsKpiGrid } from './StatsKpiGrid';
import { StatsRecentPanel } from './StatsRecentPanel';
import { StatsTrendPanel } from './StatsTrendPanel';

/**
 * 数据中心（C 端）。
 *
 * 这里只展示用户能理解、对未来创作有帮助的内容：作品积累、创作频次、
 * 近期趋势、最近作品和常用能力。成功率、失败数、模型模式等运营指标不进入
 * 用户侧页面，避免把创作中心做成后台监控面板。
 *
 * 板块拆分见 `docs/frontend-module-conventions.md`：KPI `StatsKpiGrid`、
 * 趋势 `StatsTrendPanel`、最近创作 `StatsRecentPanel`、常用能力
 * `StatsCapabilityPanel` 与空态 `StatsEmptyPanel`；取数与自动刷新落 `hooks.ts`
 * 的 `useStatsOverview`，汇总与格式化落 `utils.ts`。
 */
export function StatsPage() {
  useDocumentMeta('数据中心 · 货觉AI', '查看作品积累、创作趋势与常用能力。');
  const navigate = useNavigate();
  const { token, openLogin } = useAuth();
  const { stats, loading, refreshing, lastUpdated, error, refresh, reload } = useStatsOverview(token);

  if (!token) {
    return (
      <PersonalPage
        title={STATS_PAGE_META.title}
        description={STATS_PAGE_META.description}
        showBack={false}
      >
        <StateEmpty
          title="登录后查看你的创作数据"
          desc="作品、创作趋势和常用能力会与你的账号关联，登录后即可查看。"
          action={
            <Button type="primary" onClick={openLogin}>
              登录/注册
            </Button>
          }
        />
      </PersonalPage>
    );
  }

  if (loading) {
    return (
      <PersonalPage
        title={STATS_PAGE_META.title}
        description={STATS_PAGE_META.description}
        showBack={false}
      >
        <StateSkeleton variant="panel" count={5} />
      </PersonalPage>
    );
  }
  if (error && !stats) {
    return (
      <PersonalPage
        title={STATS_PAGE_META.title}
        description={STATS_PAGE_META.description}
        showBack={false}
      >
        <StateError
          title="创作数据加载失败"
          desc="没能取回你的创作记录。可能是网络暂时不稳定，重试一次即可。"
          onRetry={reload}
        />
      </PersonalPage>
    );
  }
  if (!stats) {
    return (
      <PersonalPage
        title={STATS_PAGE_META.title}
        description={STATS_PAGE_META.description}
        showBack={false}
      >
        <StateEmpty title="暂无创作数据" desc="完成一次创作后，这里会出现你的作品与趋势。" />
      </PersonalPage>
    );
  }

  const { totals } = stats;
  const trend = trendSummaryOf(stats.last7Days);
  const hasAnyActivity = totals.tasks > 0 || totals.assets > 0;
  const refreshFailed = Boolean(error);

  return (
    <PersonalPage
      className="stats-page"
      title={STATS_PAGE_META.title}
      description={
        <span className="stats-page-summary">
          <span>你的作品积累与创作趋势，都在这里。</span>
          {lastUpdated && (
            <span className="stats-updated-at">更新于 {formatUpdatedAt(lastUpdated)}</span>
          )}
          {totals.running > 0 && (
            <span className="stats-live">
              <i aria-hidden />
              {totals.running} 个作品生成中，自动更新
            </span>
          )}
        </span>
      }
      showBack={false}
      extra={
        <div className="stats-actions">
          {refreshFailed && (
            <span className="stats-refresh-error" title={error ?? undefined}>
              刷新失败，显示上次数据
            </span>
          )}
          <Button icon={<RefreshCw size={14} />} loading={refreshing} onClick={refresh}>
            刷新数据
          </Button>
          <Button type="primary" onClick={() => navigate('/workbench')}>
            去创作
          </Button>
        </div>
      }
    >
      <StatsKpiGrid totals={totals} trend={trend} />

      {!hasAnyActivity ? (
        <StatsEmptyPanel />
      ) : (
        <>
          <section className="stats-split">
            <StatsTrendPanel days={stats.last7Days} summary={trend} />
            <StatsRecentPanel tasks={stats.recentTasks} />
          </section>

          <StatsCapabilityPanel capabilities={stats.byCapability} totalTasks={totals.tasks} />
        </>
      )}
    </PersonalPage>
  );
}
