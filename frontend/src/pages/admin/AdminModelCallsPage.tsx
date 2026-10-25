import { useCallback, useMemo, useState } from 'react';
import { Button, Select, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { adminModelApi } from '../../lib/api';
import {
  AdminDrawer,
  AdminListError,
  AdminStaleError,
  AdminListLoading,
  adminPagination,
  useAdminList,
} from '../../components/admin/AdminWidgets';
import {
  AdminEmpty,
  FilterActions,
  FilterBar,
  PageHeader,
  Panel,
  StatCard,
} from '../../components/admin/PageHeader';
import type { AdminModelCall, AdminModelCallListResult } from '../../types/api';

type Row = AdminModelCall;

/**
 * 模型调用记录 (只读)。
 *
 * 与「操作审计」页的分工: 审计记「谁在后台做了什么」,本页记「生成链路每次调模型的明细」。
 * 排障时先看本页的统计卡判断是通道问题还是业务问题, 再下钻到流水看单次明细。
 */

/** 路由/通道 → 中文。未登记的原样显示, 便于发现未文档化的取值 */
const ROUTE_LABELS: Record<string, string> = {
  auto: '自动',
  local: '存量本地（已停用）',
  remote: '强制远程',
};

const SOURCE_LABELS: Record<string, string> = {
  gateway: '真实模型',
  local: '历史本地结果',
};

/** 毫秒 → 人类可读。耗时是这个页面的核心指标, 一律带单位 */
function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function fmtBytes(n: number): string {
  if (n <= 0) return '—';
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / 1024 / 1024).toFixed(2)}MB`;
}

export function AdminModelCallsPage() {
  const [capability, setCapability] = useState<string | undefined>();
  const [source, setSource] = useState<string | undefined>();
  const [success, setSuccess] = useState<string | undefined>();
  const [fallback, setFallback] = useState<string | undefined>();
  const [detailId, setDetailId] = useState<string | null>(null);

  const fetcher = useCallback(
    (params: Record<string, unknown>) =>
      adminModelApi.calls({
        page: params.page as number,
        pageSize: params.pageSize as number,
        capability: params.capability as string | undefined,
        source: params.source as string | undefined,
        success: params.success === undefined ? undefined : Boolean(params.success),
        fallback: params.fallback === undefined ? undefined : Boolean(params.fallback),
      }),
    [],
  );

  const { data, loading, error, setQuery, setPage, reload } =
    useAdminList<AdminModelCallListResult>(fetcher);

  const list = data?.result;
  const stats = data?.stats;

  const capOptions = useMemo(
    () =>
      (data?.capabilities ?? []).map((c) => ({
        value: c.capability,
        label: `${c.capability}（${c.count}）`,
      })),
    [data],
  );

  const reset = () => {
    setCapability(undefined);
    setSource(undefined);
    setSuccess(undefined);
    setFallback(undefined);
    setQuery({ capability: undefined, source: undefined, success: undefined, fallback: undefined });
  };

  const columns: ColumnsType<Row> = useMemo(
    () => [
      {
        title: '时间',
        dataIndex: 'createdAt',
        key: 'createdAt',
        width: 160,
        render: (v: string) => new Date(v).toLocaleString('zh-CN'),
      },
      {
        title: '能力',
        dataIndex: 'capability',
        key: 'capability',
        width: 130,
        render: (v: string) => <code>{v}</code>,
      },
      {
        title: '路由',
        dataIndex: 'route',
        key: 'route',
        width: 90,
        render: (v: string) => ROUTE_LABELS[v] ?? v,
      },
      {
        title: '实际通道',
        dataIndex: 'source',
        key: 'source',
        width: 120,
        render: (v: string, row) => (
          <div className="adm-cell-stack">
            <span className={`adm-tag ${v === 'gateway' ? 'is-success' : 'is-muted'}`}>
              {SOURCE_LABELS[v] ?? v}
            </span>
            {row.fallback && <span className="adm-tag is-danger">历史回落</span>}
          </div>
        ),
      },
      {
        title: '模型',
        dataIndex: 'model',
        key: 'model',
        width: 130,
        render: (v: string | null) => (v ? <code>{v}</code> : <span className="adm-cell-sub">—</span>),
      },
      {
        title: '耗时',
        dataIndex: 'durationMs',
        key: 'durationMs',
        width: 90,
        render: (v: number) => fmtDuration(v),
      },
      {
        title: '产出',
        key: 'output',
        width: 130,
        render: (_: unknown, row) => (
          <div className="adm-cell-stack">
            <span>{row.width && row.height ? `${row.width}×${row.height}` : '—'}</span>
            <span className="adm-cell-sub">{fmtBytes(row.outputBytes)}</span>
          </div>
        ),
      },
      {
        title: '结果',
        dataIndex: 'success',
        key: 'success',
        width: 70,
        render: (ok: boolean) => (
          <span className={`adm-tag ${ok ? 'is-success' : 'is-danger'}`}>{ok ? '成功' : '失败'}</span>
        ),
      },
      {
        title: '',
        key: 'detail',
        width: 60,
        render: (_: unknown, row) => (
          <Button type="link" className="adm-link" onClick={() => setDetailId(row.id)}>
            详情
          </Button>
        ),
      },
    ],
    [],
  );

  const detailFetcher = useCallback(async () => {
    if (!detailId) throw new Error('记录不存在');
    return adminModelApi.callDetail(detailId);
  }, [detailId]);

  const successRate =
    stats && stats.total > 0 ? `${Math.round((stats.successCount / stats.total) * 100)}%` : '—';

  return (
    <>
      <PageHeader
        title="模型调用记录"
        description="生成链路每次调用模型的明细：耗时、产出与失败原因。只读，不可删除或修改。"
      />

      {/* 统计卡: 单看流水要看上百行, 而运营真正想问的是这几个数 */}
      <div className="adm-stat-grid">
        <StatCard label="调用总数" value={stats?.total ?? '—'} hint="当前筛选条件下" />
        <StatCard
          label="成功率"
          value={successRate}
          hint={`成功 ${stats?.successCount ?? 0} 次`}
          tone={stats && stats.successCount < stats.total ? 'warn' : undefined}
        />
        <StatCard
          label="真实模型占比"
          value={stats?.total ? `${Math.round(((stats?.gatewayCount ?? 0) / stats.total) * 100)}%` : '—'}
          hint={`远程 ${stats?.gatewayCount ?? 0} · 历史本地 ${stats?.localCount ?? 0}`}
          tone={stats?.gatewayCount === 0 ? 'warn' : undefined}
        />
        <StatCard
          label="历史回落次数"
          value={stats?.fallbackCount ?? 0}
          hint="本地生成停用前由网关失败触发的回落记录"
          tone={(stats?.fallbackCount ?? 0) > 0 ? 'warn' : undefined}
        />
        <StatCard
          label="平均耗时"
          value={stats ? fmtDuration(stats.avgDurationMs) : '—'}
          hint={
            stats?.gatewayAvgDurationMs
              ? `真实模型 ${fmtDuration(stats.gatewayAvgDurationMs)}`
              : '真实模型暂无样本'
          }
        />
      </div>

      <FilterBar>
        <Select
          className="adm-filter-select"
          placeholder="能力"
          options={capOptions}
          value={capability}
          onChange={setCapability}
          allowClear
          showSearch
          optionFilterProp="label"
        />
        <Select
          className="adm-filter-select"
          placeholder="通道"
          options={[
            { value: 'gateway', label: '真实模型' },
            { value: 'local', label: '历史本地结果' },
          ]}
          value={source}
          onChange={setSource}
          allowClear
        />
        <Select
          className="adm-filter-select"
          placeholder="结果"
          options={[
            { value: 'true', label: '成功' },
            { value: 'false', label: '失败' },
          ]}
          value={success}
          onChange={setSuccess}
          allowClear
        />
        <Select
          className="adm-filter-select"
          placeholder="历史回落"
          options={[
            { value: 'true', label: '已回落' },
            { value: 'false', label: '未回落' },
          ]}
          value={fallback}
          onChange={setFallback}
          allowClear
        />
        <FilterActions>
          <Button
            type="primary"
            className="adm-btn is-primary"
            onClick={() =>
              setQuery({
                capability,
                source,
                success: success === undefined ? undefined : success === 'true',
                fallback: fallback === undefined ? undefined : fallback === 'true',
              })
            }
          >
            查询
          </Button>
          <Button type="default" className="adm-btn" onClick={reset}>
            重置
          </Button>
        </FilterActions>
      </FilterBar>

      {/* 刷新失败但手上还有上一次的数据: 只挂提示, 不把整个列表藏起来 */}
      {error && data && <AdminStaleError error={error} onRetry={reload} />}

      <Panel>
        {loading && !data ? (
          <AdminListLoading tip="加载调用记录…" />
        ) : error && !data ? (
          <AdminListError error={error} onRetry={reload} />
        ) : (list?.items.length ?? 0) === 0 ? (
          <AdminEmpty description="暂无调用记录。在前台任意生成一次（如下「自由创作」页），这里就会出现明细。" />
        ) : (
          <Table<Row>
            rowKey="id"
            size="small"
            columns={columns}
            dataSource={list?.items ?? []}
            loading={loading}
            scroll={{ x: 1080 }}
            pagination={adminPagination({
              current: list?.page ?? 1,
              pageSize: list?.pageSize ?? 20,
              total: list?.total ?? 0,
              onChange: setPage,
            })}
          />
        )}
      </Panel>

      <AdminDrawer<Row>
        open={detailId !== null}
        title="调用详情"
        onClose={() => setDetailId(null)}
        fetcher={detailFetcher}
      >
        {(row) => (
          <>
            <div className="adm-section">
              <div className="adm-section-title">调用概要</div>
              <dl className="adm-desc">
                <dt>时间</dt>
                <dd>{new Date(row.createdAt).toLocaleString('zh-CN')}</dd>
                <dt>能力</dt>
                <dd>
                  <code>{row.capability}</code>
                </dd>
                <dt>路由决策</dt>
                <dd>{ROUTE_LABELS[row.route] ?? row.route}</dd>
                <dt>实际通道</dt>
                <dd>
                  {SOURCE_LABELS[row.source] ?? row.source}
                  {row.fallback && <span className="adm-tag is-danger">历史回落</span>}
                </dd>
                <dt>模型</dt>
                <dd>{row.model ? <code>{row.model}</code> : '—'}</dd>
                <dt>耗时</dt>
                <dd>{fmtDuration(row.durationMs)}</dd>
                <dt>产出</dt>
                <dd>
                  {row.width && row.height ? `${row.width}×${row.height}` : '—'} ·{' '}
                  {fmtBytes(row.outputBytes)}
                </dd>
                <dt>结果</dt>
                <dd>
                  <span className={`adm-tag ${row.success ? 'is-success' : 'is-danger'}`}>
                    {row.success ? '成功' : '失败'}
                  </span>
                  {row.errorCode && <code className="adm-cell-sub"> {row.errorCode}</code>}
                </dd>
                {row.taskId && (
                  <>
                    <dt>网关任务</dt>
                    <dd>
                      <code>{row.taskId}</code>
                    </dd>
                  </>
                )}
              </dl>
            </div>

            {row.reason && (
              <div className="adm-section">
                <div className="adm-section-title">
                  {row.fallback ? '历史回落原因' : '备注'}
                </div>
                <div className="adm-reason-box">{row.reason}</div>
              </div>
            )}

            {row.prompt && (
              <div className="adm-section">
                <div className="adm-section-title">
                  送出提示词
                  <span className="adm-panel-note">超长内容已截断，完整参数见生成任务记录</span>
                </div>
                <pre className="adm-pre">{row.prompt}</pre>
              </div>
            )}
          </>
        )}
      </AdminDrawer>
    </>
  );
}
