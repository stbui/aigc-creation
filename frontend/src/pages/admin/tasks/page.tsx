import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Download, RefreshCw } from 'lucide-react';
import {
  ActionButton,
  AdminDataTable,
  AppliedFilters,
  BatchBar,
  BatchResultModal,
  ClearableField,
  ConfirmAction,
  FilterActions,
  FilterBar,
  Notice,
  PageHeader,
  Panel,
  SelectField,
  StatusTag,
  StaleError,
  TextField,
  type AdminColumn,
  type AppliedFilter,
} from '~/admin-ui/primitives';
import { assetThumbUrl, adminTasksApi } from './api';
import {
  useAdmin,
  useAdminDetailParam,
  useAdminList,
  useAdminUrlFilterSync,
  useDuty,
  useToast,
} from './hooks';
import {
  adminTasksHref,
  adminUserDetailHref,
  formatDuration as fmtDuration,
  shortId,
  taskErrorLabel,
} from './utils';
import { PROVIDER_LABELS, PROVIDER_OPTIONS, STATUS_OPTIONS } from './constants';
import { TaskDeleteDialog } from './TaskDeleteDialog';
import { TaskDetailDrawer } from './TaskDetailDrawer';
import { TaskStats } from './TaskStats';
import type { AdminTask, AdminTaskListResult, BatchSummary } from '../../../types/api';

type Row = AdminTask;
type TaskActionKind = 'retry' | 'cancel' | 'delete';

/**
 * 任务监控 (admin-prd.md B-28~B-33)。
 *
 * 与「模型调用记录」的分工: 那页记**每次调模型**的明细 (提示词、回落原因),
 * 本页记**任务实体**本身 —— 状态、输入、参数、产出、重试链。排障路径通常是
 * 先在本页确认"哪个任务失败了", 再去调用记录页看"这次为什么失败"。
 *
 * ## 批量动作不预筛行
 *
 * 「批量重试」只对 failed 有效、「批量终止」只对 pending/running 有效。页面
 * 不按状态限制勾选 (一次筛选后混选是常态), 而是把不合法的行交给后端逐条
 * 返回原因。前端预筛会让人以为「我明明选了 20 个, 怎么只处理了 8 个」。
 *
 * ## 模块划分
 *
 * 详情抽屉拆到 `TaskDetailDrawer`；本文件只保留列表筛选、批量动作与写操作确认。
 */
export function AdminTasksPage() {
  const toast = useToast();
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

  const [confirm, setConfirm] = useState<{ kind: TaskActionKind; task: Row } | null>(null);
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);

  const [selected, setSelected] = useState<string[]>([]);
  const [batchKind, setBatchKind] = useState<TaskActionKind | null>(null);
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
        sort: params.sort as string | undefined,
      }),
    [],
  );

  const { data, loading, error, params, setQuery, setPage, reload } =
    useAdminList<AdminTaskListResult>(fetcher, {
      sort: 'createdAt:desc',
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
    const next = raw && STATUS_OPTIONS.some((o) => o.value === raw) ? raw : undefined;
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
   * 拥堵读数由 DutyContext 提供（30 秒轮询，页面不可见时暂停）。
   *
   * 此前本页另开了一个 30 秒轮询，两处节奏不同步时「概览里的执行中」与
   * 「页面上的拥堵卡」会差一拍。本页只留列表真正需要的那条超阈值提示。
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

  /** 通道选项跟着后端的全量聚合走，未知/历史值不会变成非法筛选项 */
  const providerOptions = useMemo(() => {
    const facets = data?.providers;
    if (!facets?.length) return PROVIDER_OPTIONS;
    const options = facets
      .filter((item) => PROVIDER_OPTIONS.some((option) => option.value === item.provider))
      .map((item) => ({
        value: item.provider,
        label: `${PROVIDER_LABELS[item.provider] ?? item.provider}（${item.count}）`,
      }));
    return options.length > 0 ? options : PROVIDER_OPTIONS;
  }, [data]);

  const runBatch = async (kind: TaskActionKind) => {
    if (selected.length === 0) return;
    setBusy(true);
    try {
      const summary = await adminTasksApi.batch(selected, kind);
      setBatchTitle(
        kind === 'retry'
          ? '批量重试结果'
          : kind === 'cancel'
            ? '批量终止结果'
            : '批量删除结果',
      );
      setBatchSummary(summary);
      setBatchKind(null);
      setSelected([]);
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '批量操作失败');
    } finally {
      setBusy(false);
    }
  };

  const hasFilter = Boolean(status || capability || provider || owner || project || from || to);

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

  const openConfirm = useCallback((kind: TaskActionKind, task: Row) => {
    setConfirm({ kind, task });
  }, []);

  /** 执行确认后的动作。三个动作都要刷新列表: 重试新增行, 终止改状态, 删除移除行 */
  const runConfirm = useCallback(async () => {
    if (!confirm) return;
    setBusy(true);
    try {
      if (confirm.kind === 'retry') {
        const r = await adminTasksApi.retry(confirm.task.id);
        toast.success(`已用原参数新建任务 ${shortId(r.taskId)}`);
      } else if (confirm.kind === 'cancel') {
        await adminTasksApi.cancel(confirm.task.id);
        toast.success('任务已终止');
      } else {
        await adminTasksApi.remove(confirm.task.id);
        toast.success('任务及其产出已删除');
      }
      setConfirm(null);
      setDetailId(null);
      reload();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : '操作失败');
    } finally {
      setBusy(false);
    }
  }, [confirm, reload, setDetailId, toast]);

  const columns: Array<AdminColumn<Row>> = useMemo(
    () => [
      {
        key: 'task',
        title: '任务',
        width: 132,
        cellTitle: (row: Row) => row.id,
        render: (row: Row) => (
          <div className="flex min-w-0 items-center gap-2">
            {row.thumbnailUrl ? (
              <img
                className="size-7 shrink-0 rounded border border-border object-cover"
                src={assetThumbUrl(row.thumbnailUrl, 96)}
                alt=""
                loading="lazy"
              />
            ) : (
              <div className="size-7 shrink-0 rounded border border-dashed border-border bg-muted" />
            )}
            <code className="truncate font-mono text-[12px] text-muted-foreground">
              {shortId(row.id)}
            </code>
          </div>
        ),
      },
      {
        key: 'capability',
        title: '能力',
        width: 120,
        sortable: true,
        cellTitle: (row: Row) => `${row.capabilityName} · ${row.capability}`,
        render: (row: Row) => <span className="block truncate">{row.capabilityName}</span>,
      },
      {
        key: 'status',
        title: '状态',
        width: 92,
        sortable: true,
        cellTitle: (row: Row) =>
          row.status === 'failed' && row.errorCode ? taskErrorLabel(row.errorCode) : undefined,
        render: (row: Row) => <StatusTag status={row.status} />,
      },
      {
        key: 'provider',
        title: '通道',
        width: 78,
        /*
         * `pending` 是建任务时的初值 (还没跑出真实通道)。对失败任务显示「待执行」
         * 会与同一行的「失败」互相矛盾, 读起来像任务没开始跑; 这类行一律显示「—」。
         */
        render: (row: Row) =>
          !row.provider || (row.provider === 'pending' && row.status !== 'queued') ? (
            <span className="text-muted-foreground">—</span>
          ) : (
            <span className="rounded bg-muted px-1.5 py-0.5 text-[12px] whitespace-nowrap text-muted-foreground">
              {PROVIDER_LABELS[row.provider] ?? row.provider}
            </span>
          ),
      },
      {
        key: 'user',
        title: '用户',
        width: 156,
        cellTitle: (row: Row) => row.user.email,
        render: (row: Row) => (
          <Link
            className="block truncate text-brand hover:underline"
            to={adminUserDetailHref(row.user.id)}
          >
            {row.user.email}
          </Link>
        ),
      },
      {
        key: 'project',
        title: '项目',
        width: 128,
        cellTitle: (row: Row) => row.project.name,
        render: (row: Row) => (
          <Link
            className="block truncate text-brand hover:underline"
            to={adminTasksHref({ projectId: row.project.id })}
          >
            {row.project.name}
          </Link>
        ),
      },
      {
        key: 'durationMs',
        title: '耗时',
        width: 76,
        cellTitle: (row: Row) =>
          row.status === 'running' ? '任务执行中，耗时仍在增长' : undefined,
        render: (row: Row) => (
          <span className="text-[12px] tabular-nums whitespace-nowrap">
            {fmtDuration(row.durationMs)}
          </span>
        ),
      },
      {
        key: 'createdAt',
        title: '创建时间',
        width: 140,
        sortable: true,
        render: (row: Row) => (
          <span className="block truncate text-[12px] tabular-nums text-muted-foreground">
            {new Date(row.createdAt).toLocaleString('zh-CN')}
          </span>
        ),
      },
      {
        key: 'ops',
        title: '操作',
        width: 148,
        /* 固定在最右, 保证滚动时主操作仍可见 */
        fixed: 'right',
        render: (row: Row) => (
          <div className="flex items-center gap-1 whitespace-nowrap">
            <ActionButton variant="ghost" size="sm" onClick={() => setDetailId(row.id)}>
              详情
            </ActionButton>
            {/*
             * 重试/终止按状态出现, 而不是一律置灰:
             * 「仅失败任务可重试」是后端硬校验, 给一个点不动的按钮只会让人反复试。
             */}
            {row.status === 'failed' && can('task.retry') && (
              <ActionButton variant="ghost" size="sm" onClick={() => openConfirm('retry', row)}>
                重试
              </ActionButton>
            )}
            {(row.status === 'queued' || row.status === 'running') && can('task.cancel') && (
              <ActionButton
                variant="destructive"
                size="sm"
                onClick={() => openConfirm('cancel', row)}
              >
                终止
              </ActionButton>
            )}
            {/* 仅终态可删；排队中/执行中必须先终止，避免 worker 回写已删除任务 */}
            {(row.status === 'succeeded' ||
              row.status === 'failed' ||
              row.status === 'cancelled') &&
              can('task.delete') && (
                <ActionButton
                  variant="ghost"
                  size="sm"
                  className="text-danger-text hover:text-danger-text"
                  onClick={() => openConfirm('delete', row)}
                >
                  删除
                </ActionButton>
              )}
          </div>
        ),
      },
    ],
    [can, openConfirm, setDetailId],
  );

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
      toast.error(e instanceof Error ? e.message : '导出失败');
    } finally {
      setExporting(false);
    }
  };

  const overloaded = (liveCongestion?.running ?? 0) > (liveCongestion?.runningThreshold ?? 50);

  return (
    <>
      <PageHeader title="任务监控" />

      <TaskStats
        total={list?.total ?? null}
        congestion={liveCongestion ?? null}
        hasFilter={hasFilter}
        loading={loading}
      />

      {/* 超阈值只在真的超了才出现：常亮的阈值提示会变成装饰 */}
      {overloaded && (
        <Notice
          tone="warn"
          title={`执行中 ${liveCongestion?.running} 已超阈值 ${liveCongestion?.runningThreshold}`}
        >
          通道可能跟不上提交速度，先看概览页的线路状态与冷却通道。
        </Notice>
      )}

      <FilterBar>
        <SelectField
          className="w-28"
          ariaLabel="按状态筛选"
          placeholder="状态"
          allowClear
          value={status}
          onChange={setStatus}
          options={STATUS_OPTIONS}
        />
        <SelectField
          className="w-28"
          ariaLabel="按能力筛选"
          placeholder="能力"
          allowClear
          value={capability}
          onChange={setCapability}
          options={capOptions}
        />
        <SelectField
          className="w-28"
          ariaLabel="按通道筛选"
          placeholder="通道"
          allowClear
          value={provider}
          onChange={setProvider}
          options={providerOptions}
        />
        {/*
         * 用户/项目用 id 直填而非下拉:
         * 后台用户可能有成千上万, 下拉搜索反而不如粘贴 id 快
         * (运营手上通常正有从工单/日志里复制的 id)。
         */}
        <ClearableField
          className="w-32"
          ariaLabel="按用户 ID 筛选"
          placeholder="用户 ID"
          value={owner}
          onChange={setOwner}
          onEnter={applyQuery}
        />
        <ClearableField
          className="w-32"
          ariaLabel="按项目 ID 筛选"
          placeholder="项目 ID"
          value={project}
          onChange={setProject}
          onEnter={applyQuery}
        />
        <TextField
          className="w-44"
          type="datetime-local"
          ariaLabel="开始时间"
          value={from}
          onChange={setFrom}
          onEnter={applyQuery}
        />
        <TextField
          className="w-44"
          type="datetime-local"
          ariaLabel="结束时间"
          value={to}
          onChange={setTo}
          onEnter={applyQuery}
        />
        <FilterActions>
          <ActionButton variant="default" size="sm" onClick={applyQuery}>
            查询
          </ActionButton>
          <ActionButton variant="secondary" size="sm" onClick={reset}>
            重置
          </ActionButton>
        </FilterActions>
        <AppliedFilters items={appliedChips} onClearAll={reset} />
      </FilterBar>

      {/* 刷新失败但手上还有上一次的数据: 只挂提示, 不把整个列表藏起来 */}
      {error && data && <StaleError error={error} onRetry={reload} />}

      <Panel
        title="任务列表"
        extra={
          <>
            <BatchBar
              count={selected.length}
              unit="项"
              className="mb-0 rounded-none border-0 bg-transparent p-0"
            >
              {can('task.retry') && (
                <ActionButton
                  variant="secondary"
                  size="sm"
                  disabled={busy}
                  onClick={() => {
                    setBatchKind('retry');
                  }}
                >
                  批量重试
                </ActionButton>
              )}
              {can('task.cancel') && (
                <ActionButton
                  variant="destructive"
                  size="sm"
                  disabled={busy}
                  onClick={() => {
                    setBatchKind('cancel');
                  }}
                >
                  批量终止
                </ActionButton>
              )}
              {can('task.delete') && (
                <ActionButton
                  variant="ghost"
                  size="sm"
                  className="text-danger-text hover:text-danger-text"
                  disabled={busy}
                  onClick={() => {
                    setBatchKind('delete');
                  }}
                >
                  批量删除
                </ActionButton>
              )}
              <ActionButton variant="ghost" size="sm" onClick={() => setSelected([])}>
                清空选择
              </ActionButton>
            </BatchBar>
            {selected.length > 0 && <span className="h-5 w-px bg-border" aria-hidden />}
            <ActionButton
              variant="secondary"
              size="sm"
              icon={RefreshCw}
              disabled={loading}
              onClick={reload}
            >
              {loading ? '刷新中…' : '刷新'}
            </ActionButton>
            {can('data.export') && (
              <ActionButton
                variant="secondary"
                size="sm"
                icon={Download}
                disabled={exporting}
                onClick={() => void exportCsv()}
              >
                {exporting ? '导出中…' : '导出 CSV'}
              </ActionButton>
            )}
          </>
        }
      >
        <AdminDataTable<Row>
          rows={list?.items ?? []}
          columns={columns}
          rowKey={(row) => row.id}
          loading={loading}
          error={error}
          onRetry={reload}
          sort={params.sort as string | undefined}
          onSortChange={(next) => setQuery({ sort: next ?? 'createdAt:desc' }, false)}
          /* 单字段单行展示: 固定列宽，避免内容把行高重新撑成两行 */
          minWidth={1080}
          fixedLayout density="compact"
          selectable
          selected={selected}
          onSelectedChange={setSelected}
          /*
           * 整行可点开详情。此前只有最右侧那个「详情」文字链是入口,
           * 而它恰好是被横向裁掉的那一列。
           */
          onRowClick={(row) => setDetailId(row.id)}
          emptyText={
            hasFilter
              ? '没有符合条件的任务。清除筛选或换一个条件试试。'
              : '还没有任务。在前台任意生成一次，这里就会出现记录。'
          }
          emptyAction={
            hasFilter ? (
              <ActionButton variant="secondary" size="sm" onClick={reset}>
                清除筛选
              </ActionButton>
            ) : undefined
          }
          pagination={
            list
              ? {
                  current: list.page,
                  pageSize: list.pageSize,
                  total: list.total,
                  unit: '条',
                  onChange: (page, size) => {
                    setSelected([]);
                    setPage(page, size);
                  },
                }
              : undefined
          }
        />
      </Panel>

      <TaskDetailDrawer
        detailId={detailId}
        rows={list?.items ?? []}
        canRetry={can('task.retry')}
        canCancel={can('task.cancel')}
        canDelete={can('task.delete')}
        onClose={() => setDetailId(null)}
        onAction={openConfirm}
      />

      {confirm?.kind === 'delete' && (
        <TaskDeleteDialog
          open
          title="删除任务及其产出"
          target={`任务 ${shortId(confirm.task.id)} · ${confirm.task.capabilityName}`}
          loading={busy}
          onCancel={() => setConfirm(null)}
          onConfirm={() => void runConfirm()}
        />
      )}

      {confirm && confirm.kind !== 'delete' && (
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
                <p className="mt-1 text-muted-foreground">
                  任务 {shortId(confirm.task.id)} · {confirm.task.capabilityName}
                </p>
              </>
            ) : (
              <>
                <p>
                  任务将被置为失败，用户端立即看到失败状态。
                  <b>已发出的模型调用仍会跑完并计费</b>，但产出图不会再入库。
                </p>
                <p className="mt-1 text-muted-foreground">
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
        />
      )}

      {/* 批量重试 / 终止 / 删除: 一次作用于 N 条, 更需要理由留痕 */}
      {batchKind === 'delete' && (
        <TaskDeleteDialog
          open
          title={`批量删除 ${selected.length} 个任务`}
          target={`已选择 ${selected.length} 个任务；排队中、执行中或已不存在的任务会被跳过。`}
          loading={busy}
          onCancel={() => setBatchKind(null)}
          onConfirm={() => void runBatch(batchKind)}
        />
      )}

      {batchKind && batchKind !== 'delete' && (
        <ConfirmAction
          open
          title={
            batchKind === 'retry'
              ? `批量重试 ${selected.length} 个任务`
              : `批量终止 ${selected.length} 个任务`
          }
          confirmText={batchKind === 'retry' ? '确认重试' : '确认终止'}
          danger={batchKind === 'cancel'}
          loading={busy}
          onCancel={() => setBatchKind(null)}
          onConfirm={() => void runBatch(batchKind)}
          description={
            batchKind === 'retry' ? (
              <>
                <p>
                  将为每个<b>失败</b>任务用原参数新建一个任务。非失败状态的行会被跳过，
                  原因会在结果里逐条列出。
                </p>
                <p className="mt-1 text-muted-foreground">
                  重试会真实消耗模型额度，批量执行请先确认数量。
                </p>
              </>
            ) : (
              <>
                <p>
                  选中的<b>等待中 / 执行中</b>任务会被置为失败并立即对用户可见。
                  已完成的或已失败的行会被跳过。
                </p>
                <p className="mt-1 text-muted-foreground">
                  已发出的模型调用仍会跑完并计费，但产出图不再入库。
                </p>
              </>
            )
          }
          impact={
            batchKind === 'retry'
              ? [`最多新增 ${selected.length} 个任务`, '每个任务将真实消耗模型额度']
              : ['目标任务状态变为失败', '不可撤销（需重新发起生成）']
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
