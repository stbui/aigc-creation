import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, RefreshCw, Sparkles } from 'lucide-react';
import { assetThumbUrl, statsApi } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useDocumentMeta } from '../hooks/useDocumentMeta';
import { PersonalPage } from '../components/PersonalPage';
import { StateEmpty, StateError, StateSkeleton } from '../components/StateViews';
import type { StatsOverview } from '../types/api';
import { Button } from '../ui';

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

const TASK_STATUS: Record<string, { label: string; tone: string }> = {
  succeeded: { label: '已完成', tone: 'ok' },
  failed: { label: '未完成', tone: 'bad' },
  running: { label: '生成中', tone: 'run' },
  queued: { label: '排队中', tone: 'run' },
  pending: { label: '排队中', tone: 'run' },
  cancelled: { label: '已取消', tone: 'muted' },
};

/** `2026-10-30` → 周几。按本地时间解析, 避免 UTC 偏移把日期挪一天 */
function weekdayOf(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  return Number.isNaN(d.getTime()) ? '' : WEEKDAYS[d.getDay()];
}

/** 最近创作时间: 同年只留 MM-DD HH:mm, 跨年才补年份 */
function formatTaskTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const opts: Intl.DateTimeFormatOptions = {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  };
  if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
  return d.toLocaleString('zh-CN', opts);
}

function formatUpdatedAt(date: Date): string {
  return date.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

/**
 * 数据中心（C 端）。
 *
 * 这里只展示用户能理解、对未来创作有帮助的内容：作品积累、创作频次、
 * 近期趋势、最近作品和常用能力。成功率、失败数、模型模式等运营指标不进入
 * 用户侧页面，避免把创作中心做成后台监控面板。
 */
export function StatsPage() {
  useDocumentMeta('数据中心 · 货觉AI', '查看作品积累、创作趋势与常用能力。');
  const navigate = useNavigate();
  const { token, openLogin } = useAuth();
  const [stats, setStats] = useState<StatsOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  /**
   * 加载失败与「没有统计数据」必须分开：失败要给重试入口，
   * 刷新失败则保留上次已加载的数据，不让整页突然消失。
   */
  const [error, setError] = useState<string | null>(null);

  const load = useCallback((mode: 'initial' | 'refresh' = 'initial') => {
    if (mode === 'initial') setLoading(true);
    else setRefreshing(true);
    setError(null);
    statsApi
      .overview()
      .then((s) => {
        setStats(s);
        setLastUpdated(new Date());
      })
      .catch((e: unknown) => {
        console.warn('[stats] 创作数据加载失败', e);
        setError(e instanceof Error ? e.message : '创作数据加载失败');
        if (mode === 'initial') setStats(null);
      })
      .finally(() => {
        setLoading(false);
        setRefreshing(false);
      });
  }, []);

  // 依赖 token: 登录成功/退出都会触发重新拉取。
  useEffect(() => {
    if (!token) {
      setStats(null);
      setLastUpdated(null);
      setLoading(false);
      return;
    }
    load();
  }, [token, load]);

  // 有生成中的创作时后台刷新，完成后自动显示最新作品。
  useEffect(() => {
    if (!token || !stats?.totals.running) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') load('refresh');
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [load, stats?.totals.running, token]);

  if (!token) {
    return (
      <PersonalPage title="数据中心" description="查看作品积累、创作趋势与常用能力。" showBack={false}>
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
      <PersonalPage title="数据中心" description="查看作品积累、创作趋势与常用能力。" showBack={false}>
        <StateSkeleton variant="panel" count={5} />
      </PersonalPage>
    );
  }
  if (error && !stats) {
    return (
      <PersonalPage title="数据中心" description="查看作品积累、创作趋势与常用能力。" showBack={false}>
        <StateError
          title="创作数据加载失败"
          desc="没能取回你的创作记录。可能是网络暂时不稳定，重试一次即可。"
          detail={error}
          onRetry={() => load()}
        />
      </PersonalPage>
    );
  }
  if (!stats) {
    return (
      <PersonalPage title="数据中心" description="查看作品积累、创作趋势与常用能力。" showBack={false}>
        <StateEmpty title="暂无创作数据" desc="完成一次创作后，这里会出现你的作品与趋势。" />
      </PersonalPage>
    );
  }

  const { totals } = stats;
  const total7 = stats.last7Days.reduce((sum, d) => sum + d.count, 0);
  const peak7 = Math.max(0, ...stats.last7Days.map((d) => d.count));
  const activeDays = stats.last7Days.filter((d) => d.count > 0).length;
  const maxDay = Math.max(1, peak7);
  const dailyAvg = stats.last7Days.length ? total7 / stats.last7Days.length : 0;
  const hasAnyActivity = totals.tasks > 0 || totals.assets > 0;
  const hasRecentOutput = total7 > 0;
  const refreshFailed = Boolean(error && stats);

  return (
    <PersonalPage
      className="stats-page"
      title="数据中心"
      description={
        <span className="stats-page-summary">
          <span>你的作品积累与创作趋势，都在这里。</span>
          {lastUpdated && <span className="stats-updated-at">更新于 {formatUpdatedAt(lastUpdated)}</span>}
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
          <Button
            icon={<RefreshCw size={14} />}
            loading={refreshing}
            onClick={() => load('refresh')}
          >
            刷新数据
          </Button>
          <Button type="primary" onClick={() => navigate('/workbench')}>
            去创作
          </Button>
        </div>
      }
    >
      <section className="stats-kpis">
        <article className="stats-kpi">
          <span className="stats-kpi-label">累计作品</span>
          <span className="stats-kpi-value">{totals.generated}</span>
          <span className="stats-kpi-sub">可在「我的作品」中查看</span>
        </article>

        <article className="stats-kpi">
          <span className="stats-kpi-label">创作次数</span>
          <span className="stats-kpi-value">{totals.tasks}</span>
          <span className="stats-kpi-sub">
            已完成 <b>{totals.succeeded}</b>
          </span>
        </article>

        <article className="stats-kpi">
          <span className="stats-kpi-label">创作项目</span>
          <span className="stats-kpi-value">{totals.projects}</span>
          <span className="stats-kpi-sub">
            素材总量 <b>{totals.assets}</b>
          </span>
        </article>

        <article className="stats-kpi">
          <span className="stats-kpi-label">近 7 天创作</span>
          <span className="stats-kpi-value">{total7}</span>
          <span className="stats-kpi-sub">
            <span>活跃 <b>{activeDays}</b> 天</span>
            <span>日均 <b>{dailyAvg.toFixed(1)}</b></span>
          </span>
        </article>
      </section>

      {!hasAnyActivity ? (
        <article className="stats-panel stats-empty-panel">
          <span className="stats-empty-mark" aria-hidden>
            <Sparkles size={20} />
          </span>
          <div className="stats-empty-copy">
            <h3>从第一次创作开始积累作品</h3>
            <p>去工作台选择一个能力，提交创作后这里会展示你的作品趋势和常用能力。</p>
          </div>
          <Button type="primary" onClick={() => navigate('/workbench')}>
            开始创作
          </Button>
        </article>
      ) : (
        <>
          <section className="stats-split">
            <article className="stats-panel">
              <header className="stats-panel-head">
                <h4 className="stats-panel-title">创作趋势</h4>
                {hasRecentOutput && (
                  <span className="stats-panel-meta">峰值 {peak7} 次 · 共 {total7} 次</span>
                )}
              </header>
              {hasRecentOutput ? (
                <div
                  className="stats-trend"
                  role="img"
                  aria-label={`近 7 天共创作 ${total7} 次，峰值 ${peak7} 次，活跃 ${activeDays} 天`}
                >
                  {stats.last7Days.map((d, i) => {
                    const today = i === stats.last7Days.length - 1;
                    const h = d.count === 0 ? 0 : Math.max(4, Math.round((d.count / maxDay) * 100));
                    return (
                      <div key={d.date} className={`stats-trend-col${today ? ' is-today' : ''}`}>
                        <span className="stats-trend-count">{d.count || ''}</span>
                        <div className="stats-trend-track">
                          <span
                            className={`stats-trend-bar${d.count === 0 ? ' is-zero' : ''}`}
                            style={{ height: `${h}%` }}
                            title={`${d.date}：${d.count} 次创作`}
                          />
                        </div>
                        <span className="stats-trend-day">
                          {weekdayOf(d.date)}
                          <em>{d.date.slice(5)}</em>
                        </span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <StateEmpty compact title="近 7 天还没有创作" desc="完成一次创作后，这里会显示每天的创作趋势。" />
              )}
            </article>

            <article className="stats-panel">
              <header className="stats-panel-head">
                <h4 className="stats-panel-title">最近创作</h4>
                {stats.recentTasks.length > 0 && (
                  <Button type="link" size="small" onClick={() => navigate('/works')}>
                    查看作品
                  </Button>
                )}
              </header>
              {stats.recentTasks.length === 0 ? (
                <StateEmpty
                  compact
                  title="暂无创作"
                  desc="完成一次创作后，最近作品会出现在这里。"
                  action={
                    <Button type="text" onClick={() => navigate('/workbench')}>
                      去创作
                    </Button>
                  }
                />
              ) : (
                <ul className="stats-recent">
                  {stats.recentTasks.map((t) => {
                    const s = TASK_STATUS[t.status] ?? { label: t.status, tone: 'run' };
                    return (
                      <li key={t.id}>
                        <button
                          type="button"
                          className="stats-recent-row"
                          onClick={() => navigate('/works')}
                          aria-label={`查看 ${t.name} 作品`}
                        >
                          {t.thumbnailUrl ? (
                            <img
                              className="stats-recent-thumb"
                              src={assetThumbUrl(t.thumbnailUrl, 128)}
                              alt=""
                              loading="lazy"
                              decoding="async"
                            />
                          ) : (
                            <span className="stats-recent-thumb is-empty" />
                          )}
                          <span className="stats-recent-main">
                            <span className="stats-recent-name">{t.name}</span>
                            <span className="stats-recent-time">{formatTaskTime(t.createdAt)}</span>
                          </span>
                          <span className={`stats-task-status is-${s.tone}`}>{s.label}</span>
                          <ChevronRight size={14} className="stats-recent-arrow" aria-hidden />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </article>
          </section>

          <article className="stats-panel">
            <header className="stats-panel-head">
              <h4 className="stats-panel-title">常用能力</h4>
              <span className="stats-panel-meta">{stats.byCapability.length} 项能力用过</span>
            </header>
            {stats.byCapability.length === 0 ? (
              <StateEmpty compact title="还没有创作记录" desc="使用任意能力完成创作后，这里会汇总你的常用能力。" />
            ) : (
              <div className="stats-caps">
                <div className="stats-caps-head" aria-hidden>
                  <span>能力</span>
                  <span>创作次数</span>
                  <span>使用占比</span>
                </div>
                <ul className="stats-caps-list">
                  {stats.byCapability.map((c) => {
                    const share = totals.tasks ? Math.round((c.total / totals.tasks) * 100) : 0;
                    return (
                      <li key={c.capability} className="stats-cap">
                        <span className="stats-cap-name">
                          {c.thumbnailUrl ? (
                            <img
                              className="stats-cap-thumb"
                              src={assetThumbUrl(c.thumbnailUrl, 128)}
                              alt=""
                              loading="lazy"
                              decoding="async"
                            />
                          ) : (
                            <span className="stats-cap-thumb is-empty" />
                          )}
                          <span className="stats-cap-text">{c.name}</span>
                        </span>
                        <span className="stats-cap-count">
                          <b>{c.total}</b>
                          <em>次</em>
                        </span>
                        <span className="stats-cap-share">
                          <span className="stats-cap-bar">
                            <i style={{ width: `${share}%` }} />
                          </span>
                          <em>{share}%</em>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </article>
        </>
      )}
    </PersonalPage>
  );
}
