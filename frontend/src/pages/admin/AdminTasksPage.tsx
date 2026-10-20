import { useCallback, useEffect, useMemo, useState } from 'react';
import { App, Image, Input, Select, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { adminTasksApi, toAbsoluteUrl } from '../../lib/api';
import { useAdmin } from '../../context/AdminContext';
import {
  AdminDrawer,
  AdminListError,
  AdminListLoading,
  ConfirmAction,
  useAdminList,
} from '../../components/admin/AdminWidgets';
import {
  AdminEmpty,
  FilterActions,
  FilterBar,
  PageHeader,
  Panel,
  StatCard,
  StatusTag,
} from '../../components/admin/PageHeader';
import type { AdminTask, AdminTaskDetail, AdminTaskListResult } from '../../types/api';

type Row = AdminTask;

/**
 * 任务监控 (admin-prd.md B-28~B-33)。
 *
 * 与「模型调用记录」的分工: 那页记**每次调模型**的明细 (提示词、回落原因),
 * 本页记**任务实体**本身 —— 状态、输入、参数、产出、重试链。排障路径通常是
 * 先在本页确认"哪个任务失败了", 再去调用记录页看"这次为什么失败"。
 */

/** 通道 → 中文。未登记的原样显示, 便于发现未文档化的取值 */
const PROVIDER_LABELS: Record<string, string> = {
  gateway: '真实模型',
  local: '本地算法',
  // 建任务时的初值; 跑完后会被 processTask 改写成实际通道
  mock: '待执行',
};

/**
 * 错误码 → 中文说明。
 *
 * 后端只落 errorCode 字符串, 运营看到 `42201` 无法判断该找谁。至少把
 * 已知取值翻译出来; 未登记的原样显示而不是隐藏 —— 隐藏会让"未知错误码"
 * 看起来像"没有问题"。
 */
const ERROR_LABELS: Record<string, string> = {
  '42201': '生成过程异常',
  cancelled_by_admin: '后台终止',
};

/** 状态筛选的可选值。与后端 DTO 白名单一致 */
const STATUS_OPTIONS = [
  { value: 'pending', label: '等待' },
  { value: 'running', label: '执行中' },
  { value: 'succeeded', label: '已完成' },
  { value: 'failed', label: '失败' },
];

/**
 * 耗时格式化。
 *
 * <1s 显示毫秒、<1min 显示秒、更长显示时分 —— 固定单位会让 "3.5秒" 变
 * "3500ms", 运营扫视时难以快速分出快慢。
 */
function fmtDuration(ms: number): string {
  if (ms < 0) return '—';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const min = Math.floor(ms / 60_000);
  const sec = Math.round((ms % 60_000) / 1000);
  return `${min}分${sec}秒`;
}

function fmtBytes(n: number): string {
  if (n <= 0) return '—';
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / 1024 / 1024).toFixed(2)}MB`;
}

/** 任务短 id: cuid 尾部 8 位。后台表格宽度有限, 全 id 会把列挤到换行 */
function shortId(id: string): string {
  return id.slice(-8);
}

export function AdminTasksPage() {
  const { message } = App.useApp();
  const { can } = useAdmin();

  // 筛选受控值与已应用的查询分离: 用户改了下拉不代表已经点了「查询」,
  // 直接跟随会让每次切换下拉都打一次请求
  const [status, setStatus] = useState<string | undefined>();
  const [capability, setCapability] = useState<string | undefined>();
  const [provider, setProvider] = useState<string | undefined>();
  const [owner, setOwner] = useState<string>('');
  const [project, setProject] = useState<string>('');
  const [from, setFrom] = useState<string>('');
  const [to, setTo] = useState<string>('');

  const [detailId, setDetailId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ kind: 'retry' | 'cancel'; task: Row } | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const fetcher = useCallback(
    (params: Record<string, unknown>) =>
      adminTasksApi.list({
        page: params.page as number,
        pageSize: params.pageSize as number,
        status: params.status as string | undefined,
        capability: params.capability as string | undefined,
        provider: params.provider as string | undefined,
        userId: params.userId as string | undefined,
        projectId: params.projectId as string | undefined,
        from: params.from as string | undefined,
        to: params.to as string | undefined,
      }),
    [],
  );

  const { data, loading, error, setQuery, setPage, reload } =
    useAdminList<AdminTaskListResult>(fetcher);

  const list = data?.result;

  /*
   * 拥堵条独立轮询 (30s)。
   *
   * 刻意不复用列表的 loading: 列表正在翻页/筛选时不该让顶部告警数字闪成
   * 骨架, 告警数字的稳定性比实时性更重要 —— 它要在余光里就能读到。
   * 列表自带一份 congestion 作为首屏值, 之后由轮询接管。
   * 页面卸载后靠 alive 标志停止, 不留悬挂定时器。
   */
  const [liveCongestion, setLiveCongestion] = useState(data?.congestion);
  useEffect(() => {
    setLiveCongestion(data?.congestion);
  }, [data]);

  useEffect(() => {
    let alive = true;
    const tick = () => {
      adminTasksApi
        .stats()
        .then((c) => {
          if (alive) setLiveCongestion(c);
        })
        .catch(() => undefined); // 轮询失败静默: 保留上一次数字即可
    };
    const timer = window.setInterval(tick, 30_000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  const capOptions = useMemo(
    () =>
      (data?.capabilities ?? []).map((c) => ({
        value: c.capability,
        label: `${c.capability}（${c.count}）`,
      })),
    [data],
  );

  const applyQuery = () =>
    setQuery({
      status,
      capability,
      provider,
      userId: owner.trim() || undefined,
      projectId: project.trim() || undefined,
      // datetime-local 的值是 'YYYY-MM-DDTHH:mm' (无时区), new Date() 按本地
      // 时区解析, 与后端 parseDate 的行为一致, 不需再补 Z
      from: from || undefined,
      to: to || undefined,
    });

  const reset = () => {
    setStatus(undefined);
    setCapability(undefined);
    setProvider(undefined);
    setOwner('');
    setProject('');
    setFrom('');
    setTo('');
    setQuery({
      status: undefined,
      capability: undefined,
      provider: undefined,
      userId: undefined,
      projectId: undefined,
      from: undefined,
      to: undefined,
    });
  };

  /** 打开确认弹窗。重置原因输入, 避免上一次的内容被误提交 */
  const openConfirm = useCallback((kind: 'retry' | 'cancel', task: Row) => {
    setReason('');
    setConfirm({ kind, task });
  }, []);

  /** 执行确认后的动作。两个动作都要刷新列表: 重试会新增行, 终止会改状态 */
  const runConfirm = useCallback(async () => {
    if (!confirm) return;
    setBusy(true);
    const trimmed = reason.trim();
    try {
      if (confirm.kind === 'retry') {
        const r = await adminTasksApi.retry(confirm.task.id, trimmed || undefined);
        message.success(`已用原参数新建任务 ${shortId(r.taskId)}`);
      } else {
        await adminTasksApi.cancel(confirm.task.id, trimmed || undefined);
        message.success('任务已终止');
      }
      setConfirm(null);
      setDetailId(null);
      reload();
    } catch (e: unknown) {
      message.error(e instanceof Error ? e.message : '操作失败');
    } finally {
      setBusy(false);
    }
  }, [confirm, message, reason, reload]);

  const columns: ColumnsType<Row> = useMemo(
    () => [
      {
        title: '任务',
        key: 'task',
        width: 190,
        render: (_: unknown, row) => (
          <div className="adm-cell-stack">
            {/* 缩略图 + 短 id 并排: 排障时先认出图, 再对 id 查日志 */}
            <div className="adm-task-cell">
              {row.thumbnailUrl ? (
                <img
                  className="adm-task-mini"
                  src={toAbsoluteUrl(row.thumbnailUrl)}
                  alt=""
                  loading="lazy"
                />
              ) : (
                <div className="adm-task-mini is-empty" />
              )}
              <code title={row.id}>{shortId(row.id)}</code>
            </div>
            {row.retriedFromId && (
              <span className="adm-cell-sub">重试自 {shortId(row.retriedFromId)}</span>
            )}
          </div>
        ),
      },
      {
        title: '能力',
        key: 'capability',
        width: 150,
        render: (_: unknown, row) => (
          <div className="adm-cell-stack">
            {/* 中文能力名为主, id 降为副信息 —— 运营看的是"爆款复刻"不是 hot_remake */}
            <span>{row.capabilityName}</span>
            <code className="adm-cell-sub">{row.capability}</code>
          </div>
        ),
      },
      {
        title: '状态',
        dataIndex: 'status',
        key: 'status',
        width: 90,
        render: (v: string) => <StatusTag status={v} />,
      },
      {
        title: '通道',
        dataIndex: 'provider',
        key: 'provider',
        width: 90,
        render: (v: string | null) =>
          v ? <span className="adm-tag is-muted">{PROVIDER_LABELS[v] ?? v}</span> : <span className="adm-cell-sub">—</span>,
      },
      {
        title: '用户',
        key: 'user',
        width: 170,
        render: (_: unknown, row) => <span className="adm-cell-sub">{row.user.email}</span>,
      },
      {
        title: '项目',
        key: 'project',
        width: 130,
        render: (_: unknown, row) => row.project.name,
      },
      {
        title: '耗时',
        dataIndex: 'durationMs',
        key: 'durationMs',
        width: 100,
        render: (ms: number, row) => (
          <div className="adm-cell-stack">
            <span>{fmtDuration(ms)}</span>
            {/* running 的耗时仍在增长, 不加标注会被当成已完成的耗时读 */}
            {row.status === 'running' && <span className="adm-cell-sub">进行中</span>}
          </div>
        ),
      },
      {
        title: '创建时间',
        dataIndex: 'createdAt',
        key: 'createdAt',
        width: 150,
        render: (v: string) => new Date(v).toLocaleString('zh-CN'),
      },
      {
        title: '',
        key: 'ops',
        width: 130,
        render: (_: unknown, row) => (
          <div className="adm-ops">
            <button type="button" className="adm-link" onClick={() => setDetailId(row.id)}>
              详情
            </button>
            {/*
             * 重试/终止按状态出现, 而不是一律置灰:
             * 「仅失败任务可重试」是后端硬校验, 给一个点不动的按钮
             * 只会让人反复试。不可用时直接不渲染。
             */}
            {row.status === 'failed' && can('task.retry') && (
              <button
                type="button"
                className="adm-link"
                onClick={() => openConfirm('retry', row)}
              >
                重试
              </button>
            )}
            {(row.status === 'pending' || row.status === 'running') && can('task.cancel') && (
              <button
                type="button"
                className="adm-link is-danger"
                onClick={() => openConfirm('cancel', row)}
              >
                终止
              </button>
            )}
          </div>
        ),
      },
    ],
    [can, openConfirm],
  );

  const detailFetcher = useCallback(async () => {
    if (!detailId) throw new Error('任务不存在');
    return adminTasksApi.detail(detailId);
  }, [detailId]);

  const overloaded = (liveCongestion?.running ?? 0) > (liveCongestion?.runningThreshold ?? 50);

  return (
    <>
      <PageHeader
        title="任务监控"
        description="生成任务的实时状态、输入产出与失败重试。拥堵数字每 30 秒自动刷新。"
      />

      <div className="adm-stat-grid">
        <StatCard
          label="等待中"
          value={liveCongestion?.pending ?? '—'}
          hint="已提交但尚未开始执行"
          tone={(liveCongestion?.pending ?? 0) > 20 ? 'warn' : undefined}
        />
        <StatCard
          label="执行中"
          value={liveCongestion?.running ?? '—'}
          // 超阈值才提示: 不然阈值就成了永远亮着的装饰
          hint={
            overloaded
              ? `已超阈值 ${liveCongestion?.runningThreshold}, 通道可能跟不上提交速度`
              : `阈值 ${liveCongestion?.runningThreshold ?? 50}, 当前正常`
          }
          tone={overloaded ? 'danger' : undefined}
        />
        <StatCard
          label="近 1 小时失败"
          value={liveCongestion?.failedLastHour ?? '—'}
          hint="失败突增往往先于拥堵出现"
          tone={(liveCongestion?.failedLastHour ?? 0) > 0 ? 'warn' : undefined}
        />
        <StatCard
          label="当前筛选"
          value={list?.total ?? '—'}
          hint="符合筛选条件的任务总数"
        />
      </div>

      <FilterBar>
        <Select
          className="adm-filter-select"
          placeholder="状态"
          options={STATUS_OPTIONS}
          value={status}
          onChange={setStatus}
          allowClear
        />
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
            { value: 'local', label: '本地算法' },
          ]}
          value={provider}
          onChange={setProvider}
          allowClear
        />
        {/*
         * 用户/项目用 id 直填而非下拉:
         * 后台用户可能有成千上万, 下拉搜索反而不如粘贴 id 快
         * (运营手上通常正有从工单/日志里复制的 id)。
         */}
        <Input
          className="adm-filter-input"
          placeholder="用户 ID"
          value={owner}
          onChange={(e) => setOwner(e.target.value)}
          allowClear
        />
        <Input
          className="adm-filter-input"
          placeholder="项目 ID"
          value={project}
          onChange={(e) => setProject(e.target.value)}
          allowClear
        />
        <Input
          className="adm-filter-input"
          type="datetime-local"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
        <Input
          className="adm-filter-input"
          type="datetime-local"
          value={to}
          onChange={(e) => setTo(e.target.value)}
        />
        <FilterActions>
          <button type="button" className="adm-btn is-primary" onClick={applyQuery}>
            查询
          </button>
          <button type="button" className="adm-btn" onClick={reset}>
            重置
          </button>
        </FilterActions>
      </FilterBar>

      <Panel>
        {loading && !data ? (
          <AdminListLoading tip="加载任务列表…" />
        ) : error ? (
          <AdminListError error={error} onRetry={reload} />
        ) : (list?.items.length ?? 0) === 0 ? (
          <AdminEmpty description="没有符合条件的任务。在前台任意生成一次，这里就会出现记录。" />
        ) : (
          <Table<Row>
            rowKey="id"
            size="small"
            columns={columns}
            dataSource={list?.items ?? []}
            loading={loading}
            scroll={{ x: 1210 }}
            pagination={{
              current: list?.page ?? 1,
              pageSize: list?.pageSize ?? 20,
              total: list?.total ?? 0,
              showSizeChanger: true,
              pageSizeOptions: [20, 50, 100],
              showTotal: (t) => `共 ${t} 条`,
              onChange: setPage,
            }}
          />
        )}
      </Panel>

      <AdminDrawer<AdminTaskDetail>
        open={detailId !== null}
        title="任务详情"
        onClose={() => setDetailId(null)}
        fetcher={detailFetcher}
        footer={(d) => {
          const row = list?.items.find((t) => t.id === d.id);
          return (
            <div className="adm-ops">
              {d.status === 'failed' && can('task.retry') && row && (
                <button
                  type="button"
                  className="adm-btn is-primary"
                  onClick={() => openConfirm('retry', row)}
                >
                  重试此任务
                </button>
              )}
              {(d.status === 'pending' || d.status === 'running') && can('task.cancel') && row && (
                <button
                  type="button"
                  className="adm-btn is-danger"
                  onClick={() => openConfirm('cancel', row)}
                >
                  终止此任务
                </button>
              )}
            </div>
          );
        }}
      >
        {(d) => (
          <>
            <div className="adm-section">
              <div className="adm-section-title">任务概要</div>
              <dl className="adm-desc">
                <dt>任务 ID</dt>
                <dd>
                  <code>{d.id}</code>
                </dd>
                <dt>能力</dt>
                <dd>
                  {d.capabilityName} <code className="adm-cell-sub">{d.capability}</code>
                </dd>
                <dt>状态</dt>
                <dd>
                  <StatusTag status={d.status} />
                  {d.errorCode && (
                    <span className="adm-cell-sub">
                      {' '}
                      {d.errorCode}
                      {ERROR_LABELS[d.errorCode] ? ` · ${ERROR_LABELS[d.errorCode]}` : ''}
                    </span>
                  )}
                </dd>
                <dt>通道</dt>
                <dd>{d.provider ? (PROVIDER_LABELS[d.provider] ?? d.provider) : '—'}</dd>
                <dt>用户</dt>
                <dd>{d.user.email}</dd>
                <dt>项目</dt>
                <dd>{d.project.name}</dd>
                <dt>耗时</dt>
                <dd>{fmtDuration(d.durationMs)}</dd>
                <dt>创建时间</dt>
                <dd>{new Date(d.createdAt).toLocaleString('zh-CN')}</dd>
                {d.retriedFromId && (
                  <>
                    <dt>重试来源</dt>
                    <dd>
                      <code>{d.retriedFromId}</code>
                    </dd>
                  </>
                )}
              </dl>
            </div>

            <div className="adm-section">
              <div className="adm-section-title">
                状态流转
                <span className="adm-panel-note">系统未记录开始执行时刻，故不展示该节点</span>
              </div>
              <ul className="adm-timeline">
                {d.timeline.map((n) => (
                  <li key={n.key} className={`adm-timeline-item${n.done ? ' is-done' : ''}`}>
                    <span className="adm-timeline-dot" aria-hidden="true" />
                    <span className="adm-timeline-label">{n.label}</span>
                    <span className="adm-cell-sub">
                      {n.at ? new Date(n.at).toLocaleString('zh-CN') : '进行中'}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            {d.outputAsset ? (
              <div className="adm-section">
                <div className="adm-section-title">产出图</div>
                <Image
                  src={toAbsoluteUrl(d.outputAsset.sourceUrl)}
                  alt="产出图"
                  className="adm-output-img"
                  // 产出图尺寸不一, 限高避免撑爆抽屉; 点击可看原图
                  style={{ maxHeight: 320 }}
                />
                <div className="adm-cell-sub" style={{ marginTop: 6 }}>
                  {d.outputAsset.width && d.outputAsset.height
                    ? `${d.outputAsset.width}×${d.outputAsset.height}`
                    : '尺寸未知'}{' '}
                  · {d.outputAsset.format} · {fmtBytes(d.outputAsset.sizeBytes)}
                </div>
              </div>
            ) : (
              <div className="adm-section">
                <div className="adm-section-title">产出图</div>
                <div className="adm-empty">
                  <p>
                    {d.status === 'succeeded'
                      ? '任务已完成但未关联产出图，数据可能异常，请核对任务记录。'
                      : '任务尚未产出图片。'}
                  </p>
                </div>
              </div>
            )}

            {d.inputAssets.length > 0 && (
              <div className="adm-section">
                <div className="adm-section-title">
                  输入素材
                  <span className="adm-panel-note">
                    共 {d.inputAssets.length} 张，按提交顺序排列
                  </span>
                </div>
                <div className="adm-thumb-grid">
                  {d.inputAssets.map((a, i) => (
                    <Image
                      key={a.id}
                      src={toAbsoluteUrl(a.sourceUrl)}
                      alt={`输入素材 ${i + 1}`}
                      className="adm-thumb-cell"
                    />
                  ))}
                </div>
              </div>
            )}

            <div className="adm-section">
              <div className="adm-section-title">生成参数</div>
              {/* JSON.stringify 格式化; 超长时 adm-pre 自带 max-height 滚动 */}
              <pre className="adm-pre">{JSON.stringify(d.params, null, 2)}</pre>
            </div>
          </>
        )}
      </AdminDrawer>

      {confirm && (
        <ConfirmAction
          open
          title={confirm.kind === 'retry' ? '重试失败任务' : '终止任务'}
          confirmText={confirm.kind === 'retry' ? '新建任务并重试' : '确认终止'}
          danger={confirm.kind === 'cancel'}
          loading={busy}
          onCancel={() => setConfirm(null)}
          onConfirm={() => void runConfirm()}
          description={
            confirm.kind === 'retry' ? (
              <>
                <p>
                  将用<b>原任务的参数与输入素材</b>新建一个任务并重新执行，原任务与其记录保留。
                </p>
                <p className="adm-cell-sub">
                  任务 {shortId(confirm.task.id)} · {confirm.task.capabilityName}
                </p>
              </>
            ) : (
              <>
                <p>
                  任务将被置为失败，用户端立即看到失败状态。
                  <b>已发出的模型调用仍会跑完并计费</b>，但产出图不会再入库。
                </p>
                <p className="adm-cell-sub">
                  任务 {shortId(confirm.task.id)} · {confirm.task.capabilityName}
                </p>
              </>
            )
          }
          impact={
            confirm.kind === 'retry'
              ? ['新增 1 个任务，原任务记录不变', '将真实消耗模型额度', '用户端历史页会出现一条新记录']
              : [
                  '任务状态变为失败，用户端立即可见',
                  '若产出已入库，该产出图不再展示',
                  '不可撤销（需重新发起生成）',
                ]
          }
          extra={
            /*
             * 操作原因不是强制项但强烈建议填 —— 它会被 AuditInterceptor
             * 写进操作审计表。事后有人问"这个任务为什么被终止"时,
             * 这一行字就是唯一答案。
             *
             * 复用 .adm-confirm-typing 而非新建类: 二者都是「弹窗内的
             * 标签 + 单行输入」, 视觉与交互完全一致, 新造同义类只会让
             * 后续改样式要改两处。
             */
            <div className="adm-confirm-typing">
              <label htmlFor="adm-task-reason">操作原因（会记入操作审计）：</label>
              <input
                id="adm-task-reason"
                type="text"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={
                  confirm.kind === 'retry' ? '如：用户反馈重试一次' : '如：任务卡死，用户申请作废'
                }
                maxLength={200}
                autoComplete="off"
              />
            </div>
          }
        />
      )}
    </>
  );
}
