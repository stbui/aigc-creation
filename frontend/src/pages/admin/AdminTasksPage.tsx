import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { App, Button, Image, Input, Select, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { Link, useSearchParams } from 'react-router-dom';
import { adminTasksApi, toAbsoluteUrl } from '../../lib/api';
import { useAdmin } from '../../context/AdminContext';
import {
  AdminDrawer,
  AdminListError,
  AdminStaleError,
  AdminListLoading,
  ConfirmAction,
  adminPagination,
  useAdminDetailParam,
  useAdminList,
  useAdminUrlFilterSync,
} from '../../components/admin/AdminWidgets';
import {
  AdminEmpty,
  AppliedFilters,
  FilterActions,
  FilterBar,
  PageHeader,
  StatusTag,
  type AppliedFilter,
} from '../../components/admin/PageHeader';
import { AlertTriangle } from 'lucide-react';
import { BatchResultModal } from '../../components/admin/BatchResultModal';
import { useDuty } from '../../components/admin/DutyContext';
/* 耗时的写法与值班带共用一份：卡住的失败任务可能跑了几十小时，两边不能各写一套 */
import { duration as fmtDuration } from '../../components/admin/DutyBand';
import { taskErrorLabel } from '../../lib/admin-error-codes';
import {
  adminAssetHref,
  adminCreditHref,
  adminOrderHref,
  adminTaskHref,
  adminTasksHref,
  adminUserDetailHref,
} from '../../lib/admin-links';
import type {
  AdminTask,
  AdminTaskDetail,
  AdminTaskListResult,
  BatchSummary,
} from '../../types/api';

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
  local: '历史本地结果',
  // 建任务时的初值; 跑完后会被 processTask 改写成实际通道
  pending: '待执行',
};

/**
 * 错误码 → 中文说明。
 *
 * 后端只落 errorCode 字符串, 运营看到 `42201` 无法判断该找谁。至少把
 * 已知取值翻译出来; 未登记的原样显示而不是隐藏 —— 隐藏会让"未知错误码"
 * 看起来像"没有问题"。翻译表与概览页共用 lib/admin-error-codes。
 */

/** 状态筛选的可选值。与后端 DTO 白名单一致 */
const STATUS_OPTIONS = [
  { value: 'pending', label: '等待' },
  { value: 'running', label: '执行中' },
  { value: 'succeeded', label: '已完成' },
  { value: 'failed', label: '失败' },
];

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

  /*
   * 顶栏搜索与告警中心都会带参数跳过来（`?id=` / `?status=failed`）。
   * 筛选初值直接吃 URL，页面首次加载就落在正确的列表上；如果用户
   * 已经停在本页时又点了另一条告警，由下面的 effect 把新状态并进去。
   */
  const [searchParams] = useSearchParams();
  const rawUrlStatus = searchParams.get('status') ?? undefined;
  const urlStatus =
    rawUrlStatus && STATUS_OPTIONS.some((o) => o.value === rawUrlStatus) ? rawUrlStatus : undefined;
  const appliedUrlStatus = useRef<string | undefined>(urlStatus);
  const initialCapability = searchParams.get('capability') ?? undefined;
  const rawInitialProvider = searchParams.get('provider') ?? undefined;
  const initialProvider =
    rawInitialProvider && Object.prototype.hasOwnProperty.call(PROVIDER_LABELS, rawInitialProvider)
      ? rawInitialProvider
      : undefined;
  const initialOwner = searchParams.get('userId') ?? '';
  const initialProject = searchParams.get('projectId') ?? '';
  const initialFrom = searchParams.get('from') ?? '';
  const initialTo = searchParams.get('to') ?? '';
  const appliedUrlProject = useRef(initialProject);

  // 筛选受控值与已应用的查询分离: 用户改了下拉不代表已经点了「查询」,
  // 直接跟随会让每次切换下拉都打一次请求
  const [status, setStatus] = useState<string | undefined>(urlStatus);
  const [capability, setCapability] = useState<string | undefined>(initialCapability);
  const [provider, setProvider] = useState<string | undefined>(initialProvider);
  const [owner, setOwner] = useState<string>(initialOwner);
  const [project, setProject] = useState<string>(initialProject);
  const [from, setFrom] = useState<string>(initialFrom);
  const [to, setTo] = useState<string>(initialTo);

  /*
   * 顶栏搜到「任务」时带 `?id=` 跳过来, 直接打开该任务的详情抽屉。
   * 列表本身没有按 id 筛选的入口（任务 id 不是人记得住的东西）,
   * 让运营落在一条被筛过的列表上反而要从几十行里再找一遍。
   */
  const [detailId, setDetailId] = useAdminDetailParam();

  /*
   * 已在本页时点击「失败任务」告警：URL 变化但组件不会重挂，
   * 这里补一次筛选同步，避免地址栏变了列表却没动。
   * （effect 放在 useAdminList 之后，因为要用它返回的 setQuery。）
   */

  const [confirm, setConfirm] = useState<{ kind: 'retry' | 'cancel'; task: Row } | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);

  /*
   * 批量选择与批量动作。
   *
   * 「批量重试」只对 failed 有效、「批量终止」只对 pending/running 有效 ——
   * 页面不按状态过滤可选行 (一次筛选后混选是常态), 而是把不合法的行
   * 交给后端逐条返回原因, 再在结果弹窗里列出来。前端预筛会让人以为
   * "我明明选了 20 个, 怎么只处理了 8 个"。
   */
  const [selected, setSelected] = useState<string[]>([]);
  const [batchKind, setBatchKind] = useState<'retry' | 'cancel' | null>(null);
  const [batchSummary, setBatchSummary] = useState<BatchSummary<unknown> | null>(null);
  const [batchTitle, setBatchTitle] = useState('');

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

  const { data, loading, error, params, setQuery, setPage, reload } =
    useAdminList<AdminTaskListResult>(fetcher, {
      ...(urlStatus ? { status: urlStatus } : {}),
      ...(initialCapability ? { capability: initialCapability } : {}),
      ...(initialProvider ? { provider: initialProvider } : {}),
      ...(initialOwner ? { userId: initialOwner } : {}),
      ...(initialProject ? { projectId: initialProject } : {}),
      ...(initialFrom ? { from: initialFrom } : {}),
      ...(initialTo ? { to: initialTo } : {}),
    });

  /* 告警中心链接只改 URL 时，已在本页也要把筛选同步过去 */
  useEffect(() => {
    const raw = searchParams.get('status') ?? undefined;
    const next =
      raw && STATUS_OPTIONS.some((o) => o.value === raw) ? raw : undefined;
    if (next === appliedUrlStatus.current) return;
    appliedUrlStatus.current = next;
    setStatus(next);
    setQuery({ status: next });
  }, [searchParams, setQuery]);

  /* 任务详情里的项目入口与列表同页：URL 变了要同步筛选并关掉详情 */
  useEffect(() => {
    const next = searchParams.get('projectId') ?? '';
    if (next === appliedUrlProject.current) return;
    appliedUrlProject.current = next;
    setProject(next);
    setQuery({ projectId: next || undefined });
  }, [searchParams, setQuery]);

  useAdminUrlFilterSync({
    status: params.status as string | undefined,
    capability: params.capability as string | undefined,
    provider: params.provider as string | undefined,
    userId: params.userId as string | undefined,
    projectId: params.projectId as string | undefined,
    from: params.from as string | undefined,
    to: params.to as string | undefined,
  });

  const list = data?.result;

  /*
   * 拥堵读数改由值班带提供（30 秒轮询，页面不可见时暂停）。
   *
   * 此前本页另开了一个 30 秒轮询，两处节奏不同步时「带子里的执行中」与
   * 「页面上的拥堵卡」会差一拍。顶部的等待 / 执行中 / 近 1 小时失败已经
   * 由常驻值班带回答，本页只留列表真正需要的那条超阈值提示。
   */
  const { data: duty } = useDuty();
  const liveCongestion = duty?.congestion ?? data?.congestion;

  const capOptions = useMemo(
    () =>
      (data?.capabilities ?? []).map((c) => ({
        value: c.capability,
        label: `${c.capability}（${c.count}）`,
      })),
    [data],
  );

  const runBatch = async (kind: 'retry' | 'cancel') => {
    if (selected.length === 0) return;
    setBusy(true);
    const trimmed = reason.trim();
    try {
      const summary = await adminTasksApi.batch(selected, kind, trimmed || undefined);
      setBatchTitle(kind === 'retry' ? '批量重试结果' : '批量终止结果');
      setBatchSummary(summary);
      setBatchKind(null);
      setReason('');
      setSelected([]);
      reload();
    } catch (e) {
      message.error(e instanceof Error ? e.message : '批量操作失败');
    } finally {
      setBusy(false);
    }
  };

  const hasFilter = Boolean(
    status || capability || provider || owner || project || from || to,
  );

  const applyQuery = () => {
    appliedUrlStatus.current = status;
    appliedUrlProject.current = project.trim();
    setSelected([]);
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
  };

  const reset = () => {
    appliedUrlStatus.current = undefined;
    appliedUrlProject.current = '';
    setStatus(undefined);
    setCapability(undefined);
    setProvider(undefined);
    setOwner('');
    setProject('');
    setFrom('');
    setTo('');
    setSelected([]);
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

  const appliedStatus = params.status as string | undefined;
  const appliedCapability = params.capability as string | undefined;
  const appliedProvider = params.provider as string | undefined;
  const appliedOwner = (params.userId as string | undefined) ?? '';
  const appliedProject = (params.projectId as string | undefined) ?? '';
  const appliedFrom = (params.from as string | undefined) ?? '';
  const appliedTo = (params.to as string | undefined) ?? '';
  const appliedChips: AppliedFilter[] = [
    appliedStatus
      ? {
          key: 'status',
          label: `状态：${STATUS_OPTIONS.find((option) => option.value === appliedStatus)?.label ?? appliedStatus}`,
          onClear: () => {
            appliedUrlStatus.current = undefined;
            setStatus(undefined);
            setQuery({ status: undefined });
          },
        }
      : null,
    appliedCapability
      ? {
          key: 'capability',
          label: `能力：${appliedCapability}`,
          onClear: () => {
            setCapability(undefined);
            setQuery({ capability: undefined });
          },
        }
      : null,
    appliedProvider
      ? {
          key: 'provider',
          label: `通道：${PROVIDER_LABELS[appliedProvider] ?? appliedProvider}`,
          onClear: () => {
            setProvider(undefined);
            setQuery({ provider: undefined });
          },
        }
      : null,
    appliedOwner
      ? {
          key: 'userId',
          label: `用户 ID：${appliedOwner}`,
          onClear: () => {
            setOwner('');
            setQuery({ userId: undefined });
          },
        }
      : null,
    appliedProject
      ? {
          key: 'projectId',
          label: `项目 ID：${appliedProject}`,
          onClear: () => {
            appliedUrlProject.current = '';
            setProject('');
            setQuery({ projectId: undefined });
          },
        }
      : null,
    appliedFrom
      ? {
          key: 'from',
          label: `开始：${appliedFrom}`,
          onClear: () => {
            setFrom('');
            setQuery({ from: undefined });
          },
        }
      : null,
    appliedTo
      ? {
          key: 'to',
          label: `结束：${appliedTo}`,
          onClear: () => {
            setTo('');
            setQuery({ to: undefined });
          },
        }
      : null,
  ].filter(Boolean) as AppliedFilter[];

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
        width: 188,
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
        width: 126,
        render: (_: unknown, row) => (
          <div className="adm-cell-stack">
            {/* 中文能力名为主, id 降为副信息 —— 运营看的是"爆款复刻"不是 hot_remake */}
            <span className="adm-cell-clip" title={row.capabilityName}>
              {row.capabilityName}
            </span>
            <code className="adm-cell-sub adm-cell-clip" title={row.capability}>
              {row.capability}
            </code>
          </div>
        ),
      },
      {
        title: '状态',
        dataIndex: 'status',
        key: 'status',
        width: 126,
        /*
         * 失败原因直接进列表。此前只有「失败」二字, 原因要进详情抽屉才看得到,
         * 而详情入口是最右侧一条被横向裁掉一半的文字链 —— 排障动线被迫拉长。
         */
        render: (v: string, row: Row) => (
          <div className="adm-cell-stack">
            <StatusTag status={v} />
            {v === 'failed' && row.errorCode && (
              <span className="adm-cell-sub" title={row.errorCode}>
                {taskErrorLabel(row.errorCode)}
              </span>
            )}
          </div>
        ),
      },
      {
        title: '通道',
        dataIndex: 'provider',
        key: 'provider',
        width: 88,
        /*
         * `pending` 是建任务时的初值 (还没跑出真实通道)。对失败任务显示「待执行」
         * 会与同一行的「失败」互相矛盾, 读起来像任务没开始跑; 这类行一律显示「—」。
         */
        render: (v: string | null, row: Row) =>
          !v || (v === 'pending' && row.status !== 'pending') ? (
            <span className="adm-cell-sub">—</span>
          ) : (
            <span className="adm-tag is-muted">{PROVIDER_LABELS[v] ?? v}</span>
          ),
      },
      {
        title: '归属',
        key: 'owner',
        width: 276,
        render: (_: unknown, row) => (
          <div className="adm-cell-stack">
            <span className="adm-cell-sub adm-cell-clip" title={row.user.email}>
              <Link className="adm-link" to={adminUserDetailHref(row.user.id)}>
                {row.user.email}
              </Link>
            </span>
            <span className="adm-cell-sub adm-cell-clip" title={row.project.name}>
              项目 ·{' '}
              <Link className="adm-link" to={adminTasksHref({ projectId: row.project.id })}>
                {row.project.name}
              </Link>
            </span>
          </div>
        ),
      },
      {
        title: '耗时 / 创建时间',
        dataIndex: 'durationMs',
        key: 'durationMs',
        width: 150,
        render: (ms: number, row) => (
          <div className="adm-cell-stack">
            <span>
              {fmtDuration(ms)}
              {/* running 的耗时仍在增长, 不加标注会被当成已完成的耗时读 */}
              {row.status === 'running' && <span className="adm-cell-sub"> · 进行中</span>}
            </span>
            <span className="adm-cell-sub">{new Date(row.createdAt).toLocaleString('zh-CN')}</span>
          </div>
        ),
      },
      {
        title: '',
        key: 'ops',
        width: 110,
        /* 固定在最右, 保证滚动时主操作仍可见 */
        fixed: 'right',
        render: (_: unknown, row) => (
          <div className="adm-ops">
            <Button type="link" className="adm-link" onClick={() => setDetailId(row.id)}>
              详情
            </Button>
            {/*
             * 重试/终止按状态出现, 而不是一律置灰:
             * 「仅失败任务可重试」是后端硬校验, 给一个点不动的按钮
             * 只会让人反复试。不可用时直接不渲染。
             */}
            {row.status === 'failed' && can('task.retry') && (
              <Button
                type="link"
                className="adm-link"
                onClick={() => openConfirm('retry', row)}
              >
                重试
              </Button>
            )}
            {(row.status === 'pending' || row.status === 'running') && can('task.cancel') && (
              <Button
                type="link" danger
                className="adm-link is-danger"
                onClick={() => openConfirm('cancel', row)}
              >
                终止
              </Button>
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

  const exportCsv = async () => {
    setExporting(true);
    try {
      await adminTasksApi.exportCsv({
        status: params.status as string | undefined,
        capability: params.capability as string | undefined,
        provider: params.provider as string | undefined,
        userId: params.userId as string | undefined,
        projectId: params.projectId as string | undefined,
        from: params.from as string | undefined,
        to: params.to as string | undefined,
      });
    } catch (e) {
      message.error(e instanceof Error ? e.message : '导出失败');
    } finally {
      setExporting(false);
    }
  };

  const overloaded = (liveCongestion?.running ?? 0) > (liveCongestion?.runningThreshold ?? 50);

  return (
    <>
      <PageHeader
        title="任务监控"
        description={`${
          list
            ? `共 ${list.total.toLocaleString('zh-CN')} 条${hasFilter ? '符合筛选' : '任务'}`
            : '生成任务的实时状态'
        } · 状态、输入产出与失败重试`}
        actions={
          can('data.export') ? (
            <Button
              type="default"
              className="adm-btn"
              loading={exporting}
              onClick={() => void exportCsv()}
            >
              导出 CSV
            </Button>
          ) : undefined
        }
      />

      {/* 超阈值只在真的超了才出现：常亮的阈值提示会变成装饰 */}
      {overloaded && (
        <div className="adm-alert is-warn" role="status">
          <AlertTriangle size={16} />
          <div>
            <strong>
              执行中 {liveCongestion?.running} 已超阈值 {liveCongestion?.runningThreshold}
            </strong>
            <div>通道可能跟不上提交速度，先看值班带右侧的线路状态。</div>
          </div>
        </div>
      )}

      <FilterBar className="is-grid">
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
            { value: 'local', label: '历史本地结果' },
            // 「建了但没跑起来」的任务: 排障时按它筛，比逐条看状态快
            { value: 'pending', label: '待执行' },
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
          onPressEnter={applyQuery}
          allowClear
        />
        <Input
          className="adm-filter-input"
          placeholder="项目 ID"
          value={project}
          onChange={(e) => setProject(e.target.value)}
          onPressEnter={applyQuery}
          allowClear
        />
        <Input
          className="adm-filter-input"
          type="datetime-local"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          onPressEnter={applyQuery}
          aria-label="开始时间"
        />
        <Input
          className="adm-filter-input"
          type="datetime-local"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          onPressEnter={applyQuery}
          aria-label="结束时间"
        />
        {/*
         * 查询不是这一屏的主动作 —— 主动作在值班带里（接手最早异常）。
         * 筛选用默认按钮，把实心紫留给「人的决定」。
         */}
        <FilterActions>
          <Button type="default" className="adm-btn" onClick={applyQuery}>
            查询
          </Button>
          <Button type="default" className="adm-btn" onClick={reset}>
            重置
          </Button>
        </FilterActions>
        <AppliedFilters items={appliedChips} onClearAll={reset} />
      </FilterBar>

      {/* 刷新失败但手上还有上一次的数据: 只挂提示, 不把整个列表藏起来 */}
      {error && data && <AdminStaleError error={error} onRetry={reload} />}

      <div className="adm-table-block">
        {loading && !data ? (
          <AdminListLoading tip="加载任务列表…" />
        ) : error && !data ? (
          <AdminListError error={error} onRetry={reload} />
        ) : (
          <>
            {selected.length > 0 && (
              <div className="adm-bulk-bar">
                <span className="adm-bulk-count">已选 {selected.length} 项</span>
                {can('task.retry') && (
                  <Button
                    type="default"
                    className="adm-btn"
                    disabled={busy}
                    onClick={() => {
                      setReason('');
                      setBatchKind('retry');
                    }}
                  >
                    批量重试
                  </Button>
                )}
                {can('task.cancel') && (
                  <Button
                    type="primary" danger
                    className="adm-btn is-danger"
                    disabled={busy}
                    onClick={() => {
                      setReason('');
                      setBatchKind('cancel');
                    }}
                  >
                    批量终止
                  </Button>
                )}
                <Button type="link" className="adm-link" onClick={() => setSelected([])}>
                  清空选择
                </Button>
              </div>
            )}
            {(list?.items.length ?? 0) === 0 ? (
              <AdminEmpty
                description={
                  hasFilter
                    ? '没有符合条件的任务。清除筛选或换一个条件试试。'
                    : '还没有任务。在前台任意生成一次，这里就会出现记录。'
                }
                action={
                  hasFilter ? (
                    <Button type="default" className="adm-btn" onClick={reset}>
                      清除筛选
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <>
                <Table<Row>
                rowKey="id"
                size="small"
                columns={columns}
                dataSource={list?.items ?? []}
                loading={loading}
                scroll={{ x: 1120 }}
                /*
                 * 整行可点开详情。此前只有最右侧那个「详情」文字链是入口,
                 * 而它恰好是被横向裁掉的那一列。
                 */
                onRow={(record) => ({
                  onClick: (e) => {
                    const el = e.target as HTMLElement;
                    if (el.closest('button, a, input, label')) return;
                    setDetailId(record.id);
                  },
                })}
                rowClassName="adm-row-clickable"
                rowSelection={{
                  selectedRowKeys: selected,
                  onChange: (keys) => setSelected(keys as string[]),
                }}
                pagination={adminPagination({
                  current: list?.page ?? 1,
                  pageSize: list?.pageSize ?? 20,
                  total: list?.total ?? 0,
                  onChange: (page, size) => {
                    setSelected([]);
                    setPage(page, size);
                  },
                })}
                />
              </>
            )}
          </>
        )}
      </div>

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
                <Button
                  type="primary"
                  className="adm-btn is-primary"
                  onClick={() => openConfirm('retry', row)}
                >
                  重试此任务
                </Button>
              )}
              {(d.status === 'pending' || d.status === 'running') && can('task.cancel') && row && (
                <Button
                  type="primary" danger
                  className="adm-btn is-danger"
                  onClick={() => openConfirm('cancel', row)}
                >
                  终止此任务
                </Button>
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
                      {taskErrorLabel(d.errorCode) === d.errorCode
                        ? d.errorCode
                        : `${d.errorCode} · ${taskErrorLabel(d.errorCode)}`}
                    </span>
                  )}
                </dd>
                <dt>通道</dt>
                {/*
                 * 与列表列同一规则：`pending` 是建任务的初值，任务已经失败时
                 * 再写「待执行」会和上面的「失败」互相矛盾。
                 */}
                <dd>
                  {!d.provider || (d.provider === 'pending' && d.status !== 'pending')
                    ? '—'
                    : (PROVIDER_LABELS[d.provider] ?? d.provider)}
                </dd>
                <dt>用户</dt>
                <dd>
                  <Link className="adm-link" to={adminUserDetailHref(d.user.id)}>
                    {d.user.email}
                  </Link>
                  <div className="adm-relation-links">
                    <Link to={adminCreditHref({ userId: d.user.id, email: d.user.email })}>
                      积分账本
                    </Link>
                    <Link to={adminOrderHref({ email: d.user.email })}>订单记录</Link>
                  </div>
                </dd>
                <dt>项目</dt>
                <dd>
                  <Link className="adm-link" to={adminTasksHref({ projectId: d.project.id })}>
                    {d.project.name}
                  </Link>
                </dd>
                <dt>耗时</dt>
                <dd>{fmtDuration(d.durationMs)}</dd>
                <dt>创建时间</dt>
                <dd>{new Date(d.createdAt).toLocaleString('zh-CN')}</dd>
                {d.retriedFromId && (
                  <>
                    <dt>重试来源</dt>
                    <dd>
                      <Link className="adm-link" to={adminTaskHref(d.retriedFromId)}>
                        <code>{d.retriedFromId}</code>
                      </Link>
                    </dd>
                  </>
                )}
              </dl>
            </div>

            <div className="adm-section">
              <div className="adm-section-title">状态流转</div>
              <ul className="adm-timeline">
                {d.timeline.map((n) => (
                  <li key={n.key} className={`adm-timeline-item${n.done ? ' is-done' : ''}`}>
                    <span className="adm-timeline-dot" aria-hidden="true" />
                    <span className="adm-timeline-label">{n.label}</span>
                    {/*
                     * 没有时间的节点不能一律写「进行中」——
                     * pending 任务的终态节点会因此被误读成"已经开跑了"。
                     */}
                    <span className="adm-cell-sub">
                      {n.at
                        ? new Date(n.at).toLocaleString('zh-CN')
                        : n.done
                          ? '未记录具体时间'
                          : d.status === 'pending'
                            ? '尚未开始'
                            : '进行中'}
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
                  {' · '}
                  <Link className="adm-link" to={adminAssetHref(d.outputAsset.id)}>
                    在素材库查看
                  </Link>
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
              <Input
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

      {/* 批量重试 / 终止: 一次作用于 N 条, 更需要理由留痕 */}
      {batchKind && (
        <ConfirmAction
          open
          title={batchKind === 'retry' ? `批量重试 ${selected.length} 个任务` : `批量终止 ${selected.length} 个任务`}
          confirmText={batchKind === 'retry' ? '确认重试' : '确认终止'}
          danger={batchKind === 'cancel'}
          loading={busy}
          onCancel={() => {
            setBatchKind(null);
            setReason('');
          }}
          onConfirm={() => void runBatch(batchKind)}
          description={
            batchKind === 'retry' ? (
              <>
                <p>
                  将为每个<b>失败</b>任务用原参数新建一个任务。非失败状态的行会被跳过，
                  原因会在结果里逐条列出。
                </p>
                <p className="adm-cell-sub">重试会真实消耗模型额度，批量执行请先确认数量。</p>
              </>
            ) : (
              <>
                <p>
                  选中的<b>等待中 / 执行中</b>任务会被置为失败并立即对用户可见。
                  已完成的或已失败的行会被跳过。
                </p>
                <p className="adm-cell-sub">已发出的模型调用仍会跑完并计费，但产出图不再入库。</p>
              </>
            )
          }
          impact={
            batchKind === 'retry'
              ? [`最多新增 ${selected.length} 个任务`, '每个任务将真实消耗模型额度']
              : ['目标任务状态变为失败', '不可撤销（需重新发起生成）']
          }
          extra={
            <div className="adm-confirm-typing">
              <label htmlFor="adm-task-batch-reason">操作原因（会记入操作审计）：</label>
              <Input
                id="adm-task-batch-reason"
                type="text"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={
                  batchKind === 'retry' ? '如：通道恢复后批量重试' : '如：批量清理卡死任务'
                }
                maxLength={200}
                autoComplete="off"
              />
            </div>
          }
        />
      )}

      <BatchResultModal
        open={batchSummary !== null}
        title={batchTitle}
        summary={batchSummary}
        onClose={() => setBatchSummary(null)}
      />
    </>
  );
}
