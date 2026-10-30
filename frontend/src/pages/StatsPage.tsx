import { useCallback, useEffect, useState } from 'react';
import { Button, Card, Col, Row, Statistic, Table, Tag, Typography } from 'antd';
import { toAbsoluteUrl, statsApi } from '../lib/api';
import { MODE_LABELS } from '../lib/constants';
import { useAuth } from '../context/AuthContext';
import { PersonalPage } from '../components/PersonalPage';
import { StateEmpty, StateError, StateSkeleton } from '../components/StateViews';
import type { StatsOverview } from '../types/api';

const { Text } = Typography;

/** 数据中心: 全部来自真实表统计, 不编造积分/消耗类尚不存在的指标 */
export function StatsPage() {
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

  const maxDay = Math.max(1, ...stats.last7Days.map((d) => d.count));
  const hasRecentOutput = stats.last7Days.some((d) => d.count > 0);

  return (
    <PersonalPage
      className="stats-page"
      title="数据中心"
      description={`共 ${stats.totals.projects} 个项目；所有指标均来自真实生成记录。`}
      extra={
        <Button onClick={() => load()}>
          刷新数据
        </Button>
      }
    >
      <Row gutter={[12, 12]} className="stats-row">
        {[
          { label: '生成任务', value: stats.totals.tasks },
          { label: '已完成', value: stats.totals.succeeded },
          { label: '失败', value: stats.totals.failed },
          { label: '进行中', value: stats.totals.running },
          { label: '成功率', value: stats.totals.successRate === null ? '—' : `${stats.totals.successRate}%` },
          { label: '素材总量', value: stats.totals.assets },
        ].map((s) => (
          <Col xs={12} sm={8} md={4} key={s.label}>
            <Card size="small" className="stat-tile">
              <Statistic title={s.label} value={s.value} />
            </Card>
          </Col>
        ))}
      </Row>

      <Card size="small" title="近 7 天产出" className="stats-card">
        {hasRecentOutput ? (
          <div className="trend-chart">
            {stats.last7Days.map((d) => (
              <div key={d.date} className="trend-col">
                <div className="trend-bar-wrap">
                  <div
                    className="trend-bar"
                    style={{ height: `${Math.round((d.count / maxDay) * 100)}%` }}
                    title={`${d.date}: ${d.count}`}
                  />
                </div>
                <Text type="secondary" className="trend-label">
                  {d.count}
                </Text>
                <Text type="secondary" className="trend-date">
                  {d.date.slice(5)}
                </Text>
              </div>
            ))}
          </div>
        ) : (
          <StateEmpty
            compact
            title="近 7 天还没有产出"
            desc="完成一次生成后，这里会显示每天的产出数量。"
          />
        )}
      </Card>

      <Card size="small" title="按能力分布" className="stats-card">
        <Table
          size="small"
          rowKey="capability"
          pagination={false}
          /* 390 宽下四列会把「能力」压成逐字换行; 给出最小宽度并让表格自身横向滚动,
             比继续压缩列宽可读。 */
          scroll={{ x: 560 }}
          dataSource={stats.byCapability}
          locale={{ emptyText: '还没有生成记录' }}
          columns={[
            { title: '能力', dataIndex: 'name', render: (v: string, r) => (
              <span>
                {v}{' '}
                <Tag className={`tool-tag-mode tool-tag-${r.mode}`}>
                  {/* 走 MODE_LABELS 而非内联三元: 文案只此一处, 避免两处漂移 */}
                  {MODE_LABELS[r.mode] ?? r.mode}
                </Tag>
              </span>
            ) },
            { title: '任务数', dataIndex: 'total', width: 100 },
            { title: '成功数', dataIndex: 'succeeded', width: 100 },
            {
              title: '成功率',
              width: 140,
              render: (_: unknown, r) => {
                const pct = r.total ? Math.round((r.succeeded / r.total) * 100) : 0;
                return (
                  <div className="pct-cell">
                    <div className="pct-bar">
                      <div className="pct-bar-fill" style={{ width: `${pct}%` }} />
                    </div>
                    <Text type="secondary">{pct}%</Text>
                  </div>
                );
              },
            },
          ]}
        />
      </Card>

      <Card size="small" title="最近任务" className="stats-card">
        {stats.recentTasks.length === 0 ? (
          <StateEmpty compact title="暂无任务" desc="完成一次创作后，最近的任务会出现在这里。" />
        ) : (
          <div className="recent-tasks">
            {stats.recentTasks.map((t) => (
              <div key={t.id} className="recent-task-row">
                {t.thumbnailUrl ? (
                  <img src={toAbsoluteUrl(t.thumbnailUrl)} alt={t.name} loading="lazy" decoding="async" />
                ) : (
                  <span className="recent-task-empty" />
                )}
                <span className="recent-task-name">{t.name}</span>
                <span className={`recent-card-status status-${t.status}`}>
                  {t.status === 'succeeded' ? '已完成' : t.status === 'failed' ? '失败' : '进行中'}
                </span>
                <Text type="secondary" className="recent-task-time">
                  {new Date(t.createdAt).toLocaleString('zh-CN', { hour12: false })}
                </Text>
              </div>
            ))}
          </div>
        )}
      </Card>
    </PersonalPage>
  );
}
