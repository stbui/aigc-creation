import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from 'antd';
import { useNavigate } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { toAbsoluteUrl, statsApi } from '../lib/api';
import { MODE_LABELS } from '../lib/constants';
import { useAuth } from '../context/AuthContext';
import { PersonalPage } from '../components/PersonalPage';
import { StateEmpty, StateError, StateSkeleton } from '../components/StateViews';
import type { StatsOverview } from '../types/api';

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

const TASK_STATUS: Record<string, { label: string; tone: string }> = {
  succeeded: { label: '已完成', tone: 'ok' },
  failed: { label: '失败', tone: 'bad' },
  running: { label: '进行中', tone: 'run' },
  pending: { label: '排队中', tone: 'run' },
};

/** `2026-10-30` → 周几。按本地时间解析, 避免 UTC 偏移把日期挪一天 */
function weekdayOf(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  return Number.isNaN(d.getTime()) ? '' : WEEKDAYS[d.getDay()];
}

/** 最近任务时间: 同年只留 MM-DD HH:mm, 跨年才补年份 */
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

/**
 * 数据中心: 全部来自真实表统计, 不编造积分/消耗类尚不存在的指标。
 *
 * 2026-10-30 重排版:
 * - 六块等宽指标卡改为四块分层指标 (任务数带成功/失败/进行中拆分, 成功率带进度条),
 *   原先把「失败 6」和「已完成 110」画得一样大, 扫读时看不出主次;
 * - 柱状图补基线 / 周几 / 峰值说明, 当天用品牌色实心, 其余用同色降透明;
 * - 能力分布去掉每行重复的「已接入」标签 (全部能力都是真实模型, 这个标签不含信息),
 *   改为「最近产出缩略图 + 任务数 + 成功率」;
 * - 最近任务并入右栏, 与趋势图等高, 不再独占一条满宽列表。
 */
export function StatsPage() {
  const navigate = useNavigate();
  const { token, openLogin } = useAuth();
  const [stats, setStats] = useState<StatsOverview | null>(null);
  const [loading, setLoading] = useState(true);
  /**
   * 加载失败与「没有统计数据」必须分开 (2026-10-20 修)。
   * 此前两者共用 `!stats` 一个判断, 失败时渲染成 antd Empty「统计数据加载失败」,
   * 没有重试入口, 用户只能刷新页面。
   */
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    statsApi
      .overview()
      .then((s) => setStats(s))
      .catch((e: unknown) => {
        // 不静默吞错: 下方失败态会给出可操作的下一步
        console.warn('[stats] 统计数据加载失败', e);
        setError(e instanceof Error ? e.message : '统计数据加载失败');
        setStats(null);
      })
      .finally(() => setLoading(false));
  }, []);

  // 依赖 token: 登录成功/退出都会触发重新拉取, 无需额外的事件桥
  useEffect(() => {
    if (!token) {
      // guest: 统计接口需鉴权, 不发无谓请求 (路由已对外开放, 见 App.tsx 顶部说明)
      setStats(null);
      setLoading(false);
      return;
    }
    load();
  }, [token, load]);

  const total7 = useMemo(
    () => (stats ? stats.last7Days.reduce((sum, d) => sum + d.count, 0) : 0),
    [stats],
  );
  const peak7 = useMemo(
    () => (stats ? Math.max(0, ...stats.last7Days.map((d) => d.count)) : 0),
    [stats],
  );

  if (!token) {
    return (
      <PersonalPage title="数据中心" description="查看累计生成、成功率与近 7 天产出。">
        <StateEmpty
          title="登录后查看你的创作数据"
          desc="创作数据与账号绑定，登录后即可查看累计生成、成功率与近 7 天产出。"
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
      <PersonalPage title="数据中心" description="查看累计生成、成功率与近 7 天产出。">
        <StateSkeleton variant="panel" count={5} />
      </PersonalPage>
    );
  }
  if (error) {
    return (
      <PersonalPage title="数据中心" description="查看累计生成、成功率与近 7 天产出。">
        <StateError
          title="统计数据加载失败"
          desc="没能取回你的创作数据。可能是后端未启动或网络异常，重试一次即可。"
          detail={error}
          onRetry={load}
        />
      </PersonalPage>
    );
  }
  if (!stats) {
    return (
      <PersonalPage title="数据中心" description="查看累计生成、成功率与近 7 天产出。">
        <StateEmpty title="暂无统计数据" desc="完成一次创作后，这里会出现你的数据分布。" />
      </PersonalPage>
    );
  }

  const { totals } = stats;
  const maxDay = Math.max(1, peak7);
  const hasRecentOutput = total7 > 0;
  const rate = totals.successRate === null ? null : Math.max(0, Math.min(100, Math.round(totals.successRate)));
  const dailyAvg = stats.last7Days.length ? total7 / stats.last7Days.length : 0;

  return (
    <PersonalPage
      className="stats-page"
      title="数据中心"
      description={`共 ${totals.projects} 个项目；所有指标均来自真实生成记录。`}
      extra={
        <Button icon={<RefreshCw size={14} />} onClick={() => load()}>
          刷新数据
        </Button>
      }
    >
      {/* 指标分层: 主数值 + 说明, 成功/失败/进行中作为任务数的拆分, 不再各占一块 */}
      <section className="stats-kpis">
        <article className="stats-kpi">
          <span className="stats-kpi-label">生成任务</span>
          <span className="stats-kpi-value">{totals.tasks}</span>
          <span className="stats-kpi-sub">
            <span>已完成 <b>{totals.succeeded}</b></span>
            <span>
              失败 <b className={totals.failed > 0 ? 'is-bad' : undefined}>{totals.failed}</b>
            </span>
            <span>进行中 <b>{totals.running}</b></span>
          </span>
        </article>

        <article className="stats-kpi">
          <span className="stats-kpi-label">成功率</span>
          <span className="stats-kpi-value">{rate === null ? '—' : `${rate}%`}</span>
          <span className="stats-kpi-meter" aria-hidden>
            <i style={{ width: `${rate ?? 0}%` }} />
          </span>
        </article>

        <article className="stats-kpi">
          <span className="stats-kpi-label">素材总量</span>
          <span className="stats-kpi-value">{totals.assets}</span>
          <span className="stats-kpi-sub">
            <span>原创 <b>{totals.originals}</b></span>
            <span>生成 <b>{totals.generated}</b></span>
          </span>
        </article>

        <article className="stats-kpi">
          <span className="stats-kpi-label">近 7 天产出</span>
          <span className="stats-kpi-value">{total7}</span>
          <span className="stats-kpi-sub">
            <span>峰值 <b>{peak7}</b></span>
            <span>日均 <b>{dailyAvg.toFixed(1)}</b></span>
          </span>
        </article>
      </section>

      <section className="stats-split">
        <article className="stats-panel">
          <header className="stats-panel-head">
            <h4 className="stats-panel-title">产出趋势</h4>
            {hasRecentOutput && (
              <span className="stats-panel-meta">峰值 {peak7} 次 · 共 {total7} 次</span>
            )}
          </header>
          {hasRecentOutput ? (
            <div className="stats-trend">
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
                        title={`${d.date}：${d.count} 次`}
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
            <StateEmpty compact title="近 7 天还没有产出" desc="完成一次生成后，这里会显示每天的产出数量。" />
          )}
        </article>

        <article className="stats-panel">
          <header className="stats-panel-head">
            <h4 className="stats-panel-title">最近任务</h4>
            {stats.recentTasks.length > 0 && (
              <Button type="link" size="small" onClick={() => navigate('/works')}>
                查看作品
              </Button>
            )}
          </header>
          {stats.recentTasks.length === 0 ? (
            <StateEmpty compact title="暂无任务" desc="完成一次创作后，最近的任务会出现在这里。" />
          ) : (
            <ul className="stats-recent">
              {stats.recentTasks.map((t) => {
                const s = TASK_STATUS[t.status] ?? { label: t.status, tone: 'run' };
                return (
                  <li key={t.id} className="stats-recent-row">
                    {t.thumbnailUrl ? (
                      <img
                        className="stats-recent-thumb"
                        src={toAbsoluteUrl(t.thumbnailUrl)}
                        alt={t.name}
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
                  </li>
                );
              })}
            </ul>
          )}
        </article>
      </section>

      <article className="stats-panel">
        <header className="stats-panel-head">
          <h4 className="stats-panel-title">按能力分布</h4>
          <span className="stats-panel-meta">{stats.byCapability.length} 项能力有产出</span>
        </header>
        {stats.byCapability.length === 0 ? (
          <StateEmpty compact title="还没有生成记录" desc="使用任意能力完成一次生成后，这里会按能力汇总。" />
        ) : (
          <div className="stats-caps">
            <div className="stats-caps-head" aria-hidden>
              <span>能力</span>
              <span>任务 / 成功</span>
              <span>成功率</span>
            </div>
            <ul className="stats-caps-list">
              {stats.byCapability.map((c) => {
                const pct = c.total ? Math.round((c.succeeded / c.total) * 100) : 0;
                return (
                  <li key={c.capability} className="stats-cap">
                    <span className="stats-cap-name">
                      {c.thumbnailUrl ? (
                        <img
                          className="stats-cap-thumb"
                          src={toAbsoluteUrl(c.thumbnailUrl)}
                          alt=""
                          loading="lazy"
                          decoding="async"
                        />
                      ) : (
                        <span className="stats-cap-thumb is-empty" />
                      )}
                      <span className="stats-cap-text">{c.name}</span>
                      {/* 只有非真实模型能力才提示, 全部写「已接入」等于每行重复同一句话 */}
                      {c.mode !== 'real' && (
                        <span className="stats-cap-mode">{MODE_LABELS[c.mode] ?? c.mode}</span>
                      )}
                    </span>
                    <span className="stats-cap-nums">
                      <span>{c.total}</span>
                      <span>{c.succeeded}</span>
                    </span>
                    <span className="stats-cap-rate">
                      <span className="stats-cap-bar">
                        <i style={{ width: `${pct}%` }} />
                      </span>
                      <em className={pct < 60 ? 'is-low' : undefined}>{pct}%</em>
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </article>
    </PersonalPage>
  );
}
