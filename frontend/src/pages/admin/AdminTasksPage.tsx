import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Check, Download } from 'lucide-react';
import {
  ActionButton,
  AdminDataTable,
  AdminDrawer,
  AppliedFilters,
  BatchResultModal,
  ClearableField,
  ConfirmAction,
  Descriptions,
  FilterActions,
  FilterBar,
  FormField,
  Notice,
  PageHeader,
  Panel,
  SelectField,
  StatusTag,
  StaleError,
  TextField,
  formatDuration as fmtDuration,
  useAdminDetailParam,
  useAdminList,
  useAdminUrlFilterSync,
  type AdminColumn,
  type AppliedFilter,
} from '../../admin-ui/primitives';
import { cn } from '../../admin-ui/lib/cn';
import { adminTasksApi, assetThumbUrl, toAbsoluteUrl } from '../../lib/api';
import { useAdmin } from '../../context/AdminContext';
import { useToast } from '../../admin-ui/providers/ToastProvider';
import { useDuty } from '../../components/admin/DutyContext';
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
 *
 * ## 批量动作不预筛行
 *
 * 「批量重试」只对 failed 有效、「批量终止」只对 pending/running 有效。页面
 * 不按状态限制勾选 (一次筛选后混选是常态), 而是把不合法的行交给后端逐条
 * 返回原因。前端预筛会让人以为「我明明选了 20 个, 怎么只处理了 8 个」。
 */

/** 通道 → 中文。未登记的原样显示, 便于发现未文档化的取值 */
const PROVIDER_LABELS: Record<string, string> = {
  gateway: '真实模型',
  local: '历史本地结果',
  // 建任务时的初值; 跑完后会被 processTask 改写成实际通道
  pending: '待执行',
};

/** 状态筛选的可选值。与后端 DTO 白名单一致 */
const STATUS_OPTIONS = [
  { value: 'queued', label: '排队中' },
  { value: 'running', label: '执行中' },
  { value: 'succeeded', label: '已完成' },
  { value: 'failed', label: '失败' },
  { value: 'cancelled', label: '已终止' },
];

const PROVIDER_OPTIONS = [
  { value: 'gateway', label: '真实模型' },
  { value: 'local', label: '历史本地结果' },
  // 「建了但没跑起来」的任务: 排障时按它筛，比逐条看状态快
  { value: 'pending', label: '待执行' },
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

/** 详情抽屉里的小节标题：标题 + 一句口径说明 */
function Section({
  title,
  note,
  children,
}: {
  title: string;
  note?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="border-t border-border pt-3 first:border-t-0 first:pt-0">
      <div className="mb-2 flex items-baseline gap-2">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {note && <span className="text-[11px] text-muted-foreground">{note}</span>}
      </div>
      {children}
    </section>
  );
}

/**
 * 状态流转时间线。
 *
 * 新 primitives 层没有 Steps，这里按详情抽屉的需要本地实现：节点用序号 /
 * 对勾双编码，颜色仍走语义令牌（完成绿、进行中品牌紫、未开始灰）。
 */
function Steps({
  items,
}: {
  items: Array<{ title: string; done: boolean; active: boolean; description: ReactNode }>;
}) {
  return (
    <ol className="flex flex-col gap-3">
      {items.map((node, index) => (
        <li key={index} className="flex gap-3">
          <span
            className={cn(
              'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border text-[11px] tabular-nums',
              node.done
                ? 'border-success-text bg-success-soft text-success-text'
                : node.active
                  ? 'border-brand bg-accent text-brand'
                  : 'border-border bg-muted text-muted-foreground',
            )}
          >
            {node.done ? <Check className="size-3" aria-hidden /> : index + 1}
          </span>
          <div className="min-w-0">
            <div
              className={cn(
                'text-sm',
                node.done || node.active
                  ? 'font-medium text-foreground'
                  : 'text-muted-foreground',
              )}
            >
              {node.title}
            </div>
            <div className="mt-0.5 text-[11px] text-muted-foreground tabular-nums">
              {node.description}
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}

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

  const [confirm, setConfirm] = useState<{ kind: 'retry' | 'cancel'; task: Row } | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);

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

  /** 打开确认条。重置原因输入, 避免上一次的内容被误提交 */
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
        toast.success(`已用原参数新建任务 ${shortId(r.taskId)}`);
      } else {
        await adminTasksApi.cancel(confirm.task.id, trimmed || undefined);
        toast.success('任务已终止');
      }
      setConfirm(null);
      setDetailId(null);
      reload();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : '操作失败');
    } finally {
      setBusy(false);
    }
  }, [confirm, reason, reload, setDetailId, toast]);

  const columns: Array<AdminColumn<Row>> = useMemo(
    () => [
      {
        key: 'task',
        title: '任务',
        width: 188,
        render: (row: Row) => (
          <div className="flex flex-col gap-0.5">
            {/* 缩略图 + 短 id 并排: 排障时先认出图, 再对 id 查日志 */}
            <div className="flex items-center gap-2">
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
              <code className="font-mono text-[11px] text-muted-foreground" title={row.id}>
                {shortId(row.id)}
              </code>
            </div>
            {row.retriedFromId && (
              <span className="text-[11px] text-muted-foreground">
                重试自 {shortId(row.retriedFromId)}
              </span>
            )}
          </div>
        ),
      },
      {
        key: 'capability',
        title: '能力',
        width: 126,
        render: (row: Row) => (
          <div className="flex flex-col gap-0.5">
            {/* 中文能力名为主, id 降为副信息 —— 运营看的是"爆款复刻"不是 hot_remake */}
            <span className="block max-w-[120px] truncate" title={row.capabilityName}>
              {row.capabilityName}
            </span>
            <code
              className="block max-w-[120px] truncate font-mono text-[11px] text-muted-foreground"
              title={row.capability}
            >
              {row.capability}
            </code>
          </div>
        ),
      },
      {
        key: 'status',
        title: '状态',
        width: 126,
        /*
         * 失败原因直接进列表。此前只有「失败」二字, 原因要进详情抽屉才看得到,
         * 而详情入口是最右侧一条被横向裁掉一半的文字链 —— 排障动线被迫拉长。
         */
        render: (row: Row) => (
          <div className="flex flex-col gap-0.5">
            <StatusTag status={row.status} />
            {row.status === 'failed' && row.errorCode && (
              <span className="text-[11px] text-muted-foreground" title={row.errorCode}>
                {taskErrorLabel(row.errorCode)}
              </span>
            )}
          </div>
        ),
      },
      {
        key: 'provider',
        title: '通道',
        width: 88,
        /*
         * `pending` 是建任务时的初值 (还没跑出真实通道)。对失败任务显示「待执行」
         * 会与同一行的「失败」互相矛盾, 读起来像任务没开始跑; 这类行一律显示「—」。
         */
        render: (row: Row) =>
          !row.provider || (row.provider === 'pending' && row.status !== 'queued') ? (
            <span className="text-muted-foreground">—</span>
          ) : (
            <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
              {PROVIDER_LABELS[row.provider] ?? row.provider}
            </span>
          ),
      },
      {
        key: 'owner',
        title: '归属',
        width: 276,
        render: (row: Row) => (
          <div className="flex flex-col gap-0.5">
            <Link
              className="block max-w-[250px] truncate text-brand hover:underline"
              title={row.user.email}
              to={adminUserDetailHref(row.user.id)}
            >
              {row.user.email}
            </Link>
            <span className="block max-w-[250px] truncate text-[11px] text-muted-foreground" title={row.project.name}>
              项目 ·{' '}
              <Link
                className="text-brand hover:underline"
                to={adminTasksHref({ projectId: row.project.id })}
              >
                {row.project.name}
              </Link>
            </span>
          </div>
        ),
      },
      {
        key: 'durationMs',
        title: '耗时 / 创建时间',
        width: 150,
        render: (row: Row) => (
          <div className="flex flex-col gap-0.5">
            <span className="tabular-nums">
              {fmtDuration(row.durationMs)}
              {/* running 的耗时仍在增长, 不加标注会被当成已完成的耗时读 */}
              {row.status === 'running' && (
                <span className="text-[11px] text-muted-foreground"> · 进行中</span>
              )}
            </span>
            <span className="text-[11px] tabular-nums text-muted-foreground">
              {new Date(row.createdAt).toLocaleString('zh-CN')}
            </span>
          </div>
        ),
      },
      {
        key: 'ops',
        title: '',
        width: 130,
        /* 固定在最右, 保证滚动时主操作仍可见 */
        fixed: 'right',
        render: (row: Row) => (
          <div className="flex items-center gap-1">
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
          </div>
        ),
      },
    ],
    [can, openConfirm, setDetailId],
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
      toast.error(e instanceof Error ? e.message : '导出失败');
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
            <ActionButton
              variant="secondary"
              size="sm"
              icon={Download}
              disabled={exporting}
              onClick={() => void exportCsv()}
            >
              {exporting ? '导出中…' : '导出 CSV'}
            </ActionButton>
          ) : undefined
        }
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
          options={PROVIDER_OPTIONS}
        />
        {/*
         * 用户/项目用 id 直填而非下拉:
         * 后台用户可能有成千上万, 下拉搜索反而不如粘贴 id 快
         * (运营手上通常正有从工单/日志里复制的 id)。
         */}
        <ClearableField
          className="w-32"
          placeholder="用户 ID"
          value={owner}
          onChange={setOwner}
          onEnter={applyQuery}
        />
        <ClearableField
          className="w-32"
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

      <Panel title="任务列表" note={list ? `${list.total.toLocaleString('zh-CN')} 条` : undefined}>
        {selected.length > 0 && (
          <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-accent px-3 py-2">
            <span className="text-xs font-medium text-accent-foreground">已选 {selected.length} 项</span>
            {can('task.retry') && (
              <ActionButton
                variant="secondary"
                size="sm"
                disabled={busy}
                onClick={() => {
                  setReason('');
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
                  setReason('');
                  setBatchKind('cancel');
                }}
              >
                批量终止
              </ActionButton>
            )}
            <ActionButton variant="ghost" size="sm" onClick={() => setSelected([])}>
              清空选择
            </ActionButton>
          </div>
        )}

        <AdminDataTable<Row>
          rows={list?.items ?? []}
          columns={columns}
          rowKey={(row) => row.id}
          loading={loading}
          error={error}
          onRetry={reload}
          /* 1440px 视口下内容区约 1109px；1120 会多出 11px 横向滚动 */
          minWidth={1080}
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

      <AdminDrawer<AdminTaskDetail>
        open={detailId !== null}
        title="任务详情"
        onClose={() => setDetailId(null)}
        fetcher={detailFetcher}
        footer={(d) => {
          const row = list?.items.find((t) => t.id === d.id);
          if (!row) return null;
          return (
            <div className="flex items-center justify-end gap-2">
              {d.status === 'failed' && can('task.retry') && (
                <ActionButton variant="default" size="sm" onClick={() => openConfirm('retry', row)}>
                  重试此任务
                </ActionButton>
              )}
              {(d.status === 'queued' || d.status === 'running') && can('task.cancel') && (
                <ActionButton variant="destructive" size="sm" onClick={() => openConfirm('cancel', row)}>
                  终止此任务
                </ActionButton>
              )}
            </div>
          );
        }}
      >
        {(d) => (
          <div className="flex flex-col gap-4">
            <Section title="任务概要">
              <Descriptions
                columns={2}
                items={[
                  {
                    label: '任务 ID',
                    value: <code className="break-all font-mono text-xs">{d.id}</code>,
                  },
                  {
                    label: '能力',
                    value: (
                      <span className="flex flex-col">
                        {d.capabilityName}
                        <code className="font-mono text-[11px] text-muted-foreground">
                          {d.capability}
                        </code>
                      </span>
                    ),
                  },
                  {
                    label: '状态',
                    value: (
                      <span className="flex flex-col gap-0.5">
                        <StatusTag status={d.status} />
                        {d.errorCode && (
                          <span className="text-[11px] text-muted-foreground">
                            {taskErrorLabel(d.errorCode) === d.errorCode
                              ? d.errorCode
                              : `${d.errorCode} · ${taskErrorLabel(d.errorCode)}`}
                          </span>
                        )}
                      </span>
                    ),
                  },
                  {
                    label: '通道',
                    /* 与列表列同一规则：`pending` 是建任务的初值，任务已经失败时
                     * 再写「待执行」会和上面的「失败」互相矛盾。 */
                    value:
                      !d.provider || (d.provider === 'pending' && d.status !== 'queued')
                        ? '—'
                        : (PROVIDER_LABELS[d.provider] ?? d.provider),
                  },
                  {
                    label: '用户',
                    value: (
                      <span className="flex flex-col gap-1">
                        <Link
                          className="text-brand hover:underline"
                          to={adminUserDetailHref(d.user.id)}
                        >
                          {d.user.email}
                        </Link>
                        <span className="flex gap-3 text-[11px]">
                          <Link
                            className="text-brand hover:underline"
                            to={adminCreditHref({ userId: d.user.id, email: d.user.email })}
                          >
                            积分账本
                          </Link>
                          <Link
                            className="text-brand hover:underline"
                            to={adminOrderHref({ email: d.user.email })}
                          >
                            订单记录
                          </Link>
                        </span>
                      </span>
                    ),
                  },
                  {
                    label: '项目',
                    value: (
                      <Link
                        className="text-brand hover:underline"
                        to={adminTasksHref({ projectId: d.project.id })}
                      >
                        {d.project.name}
                      </Link>
                    ),
                  },
                  { label: '耗时', value: <span className="tabular-nums">{fmtDuration(d.durationMs)}</span> },
                  {
                    label: '创建时间',
                    value: (
                      <span className="tabular-nums">
                        {new Date(d.createdAt).toLocaleString('zh-CN')}
                      </span>
                    ),
                  },
                  ...(d.retriedFromId
                    ? [
                        {
                          label: '重试来源',
                          value: (
                            <Link
                              className="text-brand hover:underline"
                              to={adminTaskHref(d.retriedFromId)}
                            >
                              <code className="font-mono text-xs">{d.retriedFromId}</code>
                            </Link>
                          ),
                        },
                      ]
                    : []),
                ]}
              />
            </Section>

            <Section title="状态流转">
              <Steps
                items={d.timeline.map((n) => ({
                  title: n.label,
                  done: n.done,
                  active: !n.done && d.status !== 'queued',
                  /*
                   * 没有时间的节点不能一律写「进行中」——
                   * pending 任务的终态节点会因此被误读成"已经开跑了"。
                   */
                  description: n.at
                    ? new Date(n.at).toLocaleString('zh-CN')
                    : n.done
                      ? '未记录具体时间'
                      : d.status === 'queued'
                        ? '尚未开始'
                        : '进行中',
                }))}
              />
            </Section>

            <Section title="产出图">
              {d.outputAsset ? (
                <>
                  {/* 产出图尺寸不一, 限高避免撑爆抽屉; 原图去素材库看 */}
                  <img
                    className="max-h-[320px] w-auto rounded-lg border border-border"
                    src={toAbsoluteUrl(d.outputAsset.sourceUrl)}
                    alt="产出图"
                  />
                  <div className="mt-1.5 text-[11px] text-muted-foreground">
                    {d.outputAsset.width && d.outputAsset.height
                      ? `${d.outputAsset.width}×${d.outputAsset.height}`
                      : '尺寸未知'}{' '}
                    · {d.outputAsset.format} · {fmtBytes(d.outputAsset.sizeBytes)}
                    {' · '}
                    <Link
                      className="text-brand hover:underline"
                      to={adminAssetHref(d.outputAsset.id)}
                    >
                      在素材库查看
                    </Link>
                  </div>
                </>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {d.status === 'succeeded'
                    ? '任务已完成但未关联产出图，数据可能异常，请核对任务记录。'
                    : '任务尚未产出图片。'}
                </p>
              )}
            </Section>

            {d.inputAssets.length > 0 && (
              <Section title="输入素材" note={`共 ${d.inputAssets.length} 张，按提交顺序排列`}>
                <div className="grid grid-cols-5 gap-1.5">
                  {d.inputAssets.map((a, i) => (
                    <img
                      key={a.id}
                      className="aspect-square w-full rounded-md border border-border object-cover"
                      src={assetThumbUrl(a.sourceUrl, 240)}
                      alt={`输入素材 ${i + 1}`}
                      loading="lazy"
                    />
                  ))}
                </div>
              </Section>
            )}

            <Section title="生成参数">
              <pre className="max-h-[320px] overflow-auto rounded-lg border border-border bg-muted p-3 text-[11px] leading-5 text-muted-foreground">
                {JSON.stringify(d.params, null, 2)}
              </pre>
            </Section>
          </div>
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
          extra={
            /*
             * 操作原因不是强制项但强烈建议填 —— 它会被 AuditInterceptor
             * 写进操作审计表。事后有人问"这个任务为什么被终止"时,
             * 这一行字就是唯一答案。
             */
            <FormField label="操作原因（会记入操作审计）">
              <TextField
                ariaLabel="操作原因"
                value={reason}
                onChange={setReason}
                placeholder={
                  confirm.kind === 'retry' ? '如：用户反馈重试一次' : '如：任务卡死，用户申请作废'
                }
                maxLength={200}
              />
            </FormField>
          }
        />
      )}

      {/* 批量重试 / 终止: 一次作用于 N 条, 更需要理由留痕 */}
      {batchKind && (
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
          extra={
            <FormField label="操作原因（会记入操作审计）">
              <TextField
                ariaLabel="操作原因"
                value={reason}
                onChange={setReason}
                placeholder={
                  batchKind === 'retry' ? '如：通道恢复后批量重试' : '如：批量清理卡死任务'
                }
                maxLength={200}
              />
            </FormField>
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
