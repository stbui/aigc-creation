import { useMemo, useState } from 'react';
import { Button, Segmented } from 'antd';
import { Link } from 'react-router-dom';
import { CheckCircle2 } from 'lucide-react';
import { PageHeader, Panel } from '../../components/admin/PageHeader';
import {
  ALERT_SEVERITY_META,
  AlertRefreshButton,
  alertTime,
  useAdminAlerts,
} from '../../components/admin/AlertCenter';
import { AdminListError, AdminListLoading, AdminStaleError } from '../../components/admin/AdminWidgets';
import type { AdminAlertSeverity } from '../../types/api';

/**
 * 告警中心（/admin/alerts）。
 *
 * 顶栏铃铛只放前 5 条，这里给完整列表与口径说明。数据与铃铛同源：
 * 都来自 `GET /admin/alerts`，且按当前角色权限过滤 —— 财务看不到工单告警，
 * 运营看不到对账差异。没有待处理项时不制造「0 条告警」的噪音。
 */
export function AdminAlertsPage() {
  const { data, loading, error, reload } = useAdminAlerts();
  const [filter, setFilter] = useState<'all' | AdminAlertSeverity>('all');

  const counts = useMemo(() => {
    const base: Record<AdminAlertSeverity, number> = { critical: 0, warning: 0, info: 0 };
    for (const item of data?.items ?? []) base[item.severity] += 1;
    return base;
  }, [data]);

  const items = useMemo(
    () =>
      filter === 'all' ? (data?.items ?? []) : (data?.items ?? []).filter((i) => i.severity === filter),
    [data, filter],
  );

  return (
    <>
      <PageHeader
        title="告警中心"
        description="聚合待处理工单、失败任务、对账差异、退款卡单、备份与发票状态。只列需要动作的事项，每 60 秒刷新一次。"
        actions={<AlertRefreshButton loading={loading} onRefresh={() => void reload()} />}
      />

      {error && data && <AdminStaleError error={error} onRetry={() => void reload()} />}

      <div className="adm-stat-grid">
        <div className="adm-stat is-primary">
          <div className="adm-stat-head">
            <span className="adm-stat-label">待处理告警</span>
          </div>
          <div className="adm-stat-value">{data?.total ?? '—'}</div>
          <div className="adm-stat-hint">
            {data ? `数据截至 ${alertTime(data.generatedAt)}` : '正在检查…'}
          </div>
        </div>
        {(['critical', 'warning', 'info'] as const).map((severity) => {
          const meta = ALERT_SEVERITY_META[severity];
          const Icon = meta.icon;
          return (
            <div className="adm-stat" key={severity}>
              <div className="adm-stat-head">
                <span className="adm-stat-label">
                  <Icon size={14} className={`adm-alert-icon is-${severity}`} aria-hidden="true" />
                  {meta.label}
                </span>
              </div>
              <div className={`adm-stat-value${counts[severity] > 0 ? ` is-${meta.tone}` : ''}`}>
                {counts[severity]}
              </div>
              <div className="adm-stat-hint">
                {severity === 'critical'
                  ? '涉及资金或服务可用性，尽快处理'
                  : severity === 'warning'
                    ? '已有用户可见影响'
                    : '建议核对，不阻断运营'}
              </div>
            </div>
          );
        })}
      </div>

      <Panel>
        <div className="adm-alert-toolbar">
          <Segmented
            value={filter}
            onChange={(value) => setFilter(value as 'all' | AdminAlertSeverity)}
            options={[
              { value: 'all', label: `全部 ${data?.total ?? 0}` },
              { value: 'critical', label: `紧急 ${counts.critical}` },
              { value: 'warning', label: `需处理 ${counts.warning}` },
              { value: 'info', label: `提示 ${counts.info}` },
            ]}
          />
          <span className="adm-panel-note">
            来源按当前角色权限过滤，无权访问的模块不会出现在这里
          </span>
        </div>

        {loading && !data ? (
          <AdminListLoading tip="正在检查待处理事项…" />
        ) : error && !data ? (
          <AdminListError error={error} onRetry={() => void reload()} />
        ) : items.length === 0 ? (
          <div className="adm-bell-empty is-page">
            <CheckCircle2 size={28} aria-hidden="true" />
            <strong>{filter === 'all' ? '当前没有待处理告警' : '该级别下没有告警'}</strong>
            <span>
              {filter === 'all'
                ? '工单、任务、对账与备份都在正常范围内。'
                : '切换到「全部」查看其它级别。'}
            </span>
            {filter !== 'all' && (
              <Button size="small" onClick={() => setFilter('all')}>
                查看全部
              </Button>
            )}
          </div>
        ) : (
          <div className="adm-alert-cards">
            {items.map((item) => {
              const meta = ALERT_SEVERITY_META[item.severity];
              const Icon = meta.icon;
              return (
                <Link key={item.key} to={item.link} className={`adm-alert-card is-${item.severity}`}>
                  <span className="adm-alert-card-icon">
                    <Icon size={18} aria-hidden="true" />
                  </span>
                  <span className="adm-alert-card-main">
                    <span className="adm-alert-card-title">
                      {item.title}
                      <span className={`adm-alert-tag is-${item.severity}`}>{meta.label}</span>
                    </span>
                    <span className="adm-alert-card-detail">{item.detail}</span>
                  </span>
                  {item.count !== null && (
                    <span className="adm-alert-card-count">{item.count}</span>
                  )}
                </Link>
              );
            })}
          </div>
        )}
      </Panel>

      <div className="adm-panel">
        <div className="adm-panel-title">告警口径</div>
        <ul className="adm-alert-rules">
          <li>工单：存在尚未受理的「待回复」工单；已受理但仍在处理中的不重复告警；最早一条等待超过 24 小时升为紧急。</li>
          <li>任务：近 24 小时有失败任务，或运行中任务超过 50 个；失败达到 10 个升为紧急。</li>
          <li>对账：仍有状态为「待处置」的差异；达到 5 笔升为紧急。</li>
          <li>退款：渠道返回异步处理后超过 30 分钟仍未落账；最早一笔超过 24 小时升为紧急。点击直达订单列表的「渠道处理中」筛选。</li>
          <li>备份：最近一次备份失败，或超过 48 小时没有成功备份；未验证的备份单独提示。</li>
          <li>发票：存在待开具申请。</li>
        </ul>
        <p className="adm-panel-note">
          计数是「当前待处理数」，不引入「已读」状态：事项被处理后自然消失，
          避免出现「点过就算解决」的假象。
        </p>
      </div>
    </>
  );
}
