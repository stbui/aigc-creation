import { useEffect, useState } from 'react';
import { Card, Col, Empty, Row, Spin, Table, Tag, Typography } from 'antd';
import { toAbsoluteUrl, statsApi } from '../lib/api';
import type { StatsOverview } from '../types/api';

const { Title, Text } = Typography;

/** 数据中心: 全部来自真实表统计, 不编造积分/消耗类尚不存在的指标 */
export function StatsPage() {
  const [stats, setStats] = useState<StatsOverview | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    statsApi
      .overview()
      .then(setStats)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="list-page-loading">
        <Spin />
      </div>
    );
  }
  if (!stats) {
    return <Empty description="统计数据加载失败" />;
  }

  const maxDay = Math.max(1, ...stats.last7Days.map((d) => d.count));

  return (
    <div className="list-page">
      <div className="list-page-head">
        <Title level={3}>数据中心</Title>
        <Text type="secondary">共 {stats.totals.projects} 个项目</Text>
      </div>

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
              <Text type="secondary">{s.label}</Text>
              <div className="stat-tile-value">{s.value}</div>
            </Card>
          </Col>
        ))}
      </Row>

      <Card size="small" title="近 7 天产出" className="stats-card">
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
      </Card>

      <Card size="small" title="按能力分布" className="stats-card">
        <Table
          size="small"
          rowKey="capability"
          pagination={false}
          dataSource={stats.byCapability}
          locale={{ emptyText: '还没有生成记录' }}
          columns={[
            { title: '能力', dataIndex: 'name', render: (v: string, r) => (
              <span>
                {v} <Tag className={`tool-tag-mode tool-tag-${r.mode}`}>{r.mode === 'real' ? '本地算法' : r.mode === 'mock' ? '占位' : '规划中'}</Tag>
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
          <Empty description="暂无任务" />
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
    </div>
  );
}
