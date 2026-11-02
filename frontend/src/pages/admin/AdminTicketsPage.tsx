import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Download, Send, UserCheck } from 'lucide-react';
import {
  ActionButton,
  AdminDataTable,
  AppliedFilters,
  ClearableField,
  Descriptions,
  Drawer,
  EmptyState,
  FilterActions,
  FilterBar,
  ListError,
  PageHeader,
  Panel,
  SelectField,
  SkeletonBody,
  StatCard,
  StatusTag,
  StaleError,
  TextAreaField,
  useAdminDetailParam,
  useAdminList,
  useAdminUrlFilterSync,
  type AdminColumn,
  type AppliedFilter,
} from '../../admin-ui/primitives';
import { adminTicketsApi } from '../../lib/api';
import { useAdmin } from '../../context/AdminContext';
import { useToast } from '../../admin-ui/providers/ToastProvider';
import { cn } from '../../admin-ui/lib/cn';
import type { TagTone } from '../../components/admin/statusMeta';
import { useDiscardConfirm, useUnsavedGuard } from '../../hooks/useUnsavedGuard';
import {
  adminAssetHref,
  adminCreditHref,
  adminOrderDetailHref,
  adminOrderHref,
  adminUserDetailHref,
} from '../../lib/admin-links';
import type {
  AdminTicketDetail,
  AdminTicketListResult,
  AdminTicketRow,
  TicketPriority,
  TicketStats,
  TicketStatus,
  TicketType,
} from '../../types/api';

/**
 * 工单处理中心。
 *
 * ## 为什么详情用抽屉而不是独立页
 *
 * 客服的动线是「扫列表 → 处理 → 回列表继续下一篇」。独立详情页每次都要
 * 返回并重新定位列表位置; 抽屉关掉就回到原来的筛选与页码, 一天处理几十单
 * 时这是最大的一处省力。
 *
 * ## 为什么财务动作不在这里
 *
 * 详情里能看到关联订单与素材, 但**只能看**。退款、补发积分必须回订单模块 ——
 * 那里有退款时间窗、可退上限、积分回收一整套规则。在工单里再放一个
 * 「顺手退个款」的按钮, 两套规则迟早不一致, 而差额只有在对账时才会暴露。
 *
 * ## 状态机由后端裁决
 *
 * 前端只按同一份流转表决定**显示哪些按钮**, 真正的合法性校验在后端
 * (`TicketsService.TRANSITIONS`)。前端漏判只会看到一个 400 提示, 不会写坏数据。
 */

const TYPE_LABELS: Record<TicketType, string> = {
  bug: '功能异常',
  complaint: '投诉',
  consultation: '咨询',
  invoice: '发票问题',
  other: '其他',
};

const STATUS_LABELS: Record<TicketStatus, string> = {
  open: '待处理',
  processing: '处理中',
  resolved: '已解决',
  closed: '已关闭',
};

/** 与后端 TRANSITIONS 保持一致（仅用于决定显示哪些流转按钮） */
const TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  open: ['processing', 'resolved', 'closed'],
  processing: ['resolved', 'closed', 'open'],
  resolved: ['closed', 'open'],
  closed: ['open'],
};

/**
 * 状态 → 标签色。
 *
 * 不直接复用 `STATUS_META`：`open` 在账号/商品语境下是「正常」的绿色，
 * 在这里是「待处理」的黄色。语义相同、颜色相反，覆盖一层比改共享表安全。
 */
const STATUS_TONE: Record<TicketStatus, TagTone> = {
  open: 'warn',
  processing: 'brand',
  resolved: 'success',
  closed: 'muted',
};

const PRIORITY_TONE: Record<TicketPriority, TagTone> = {
  high: 'danger',
  normal: 'brand',
  low: 'muted',
};

/** URL 里只接受这四个状态，避免告警链接被手工改成非法值时整页 400 */
const TICKET_STATUSES: TicketStatus[] = ['open', 'processing', 'resolved', 'closed'];

const PRIORITY_LABELS: Record<TicketPriority, string> = {
  low: '低',
  normal: '中',
  high: '高',
};

/** 状态流转动作的界面文案（与目标状态一一对应） */
function transitionLabel(to: TicketStatus): string {
  return to === 'processing'
    ? '受理'
    : to === 'resolved'
      ? '标记已解决'
      : to === 'closed'
        ? '关闭工单'
        : '重新打开';
}

/** 详情里的小节标题 */
function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="border-t border-border pt-3">
      <div className="mb-2 flex items-baseline gap-2">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {note && <span className="text-[12px] text-muted-foreground">{note}</span>}
      </div>
      {children}
    </section>
  );
}

/** 对话气泡：客户在左、客服在右，避免一长串同色消息分不清谁说的 */
function Message({
  author,
  at,
  body,
  fromAdmin = false,
}: {
  author: string;
  at: string;
  body: string;
  fromAdmin?: boolean;
}) {
  return (
    <div
      className={cn(
        'rounded-lg border px-3 py-2',
        fromAdmin ? 'ml-10 border-brand/20 bg-accent' : 'border-border bg-card',
      )}
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-xs font-medium text-foreground">{author}</span>
        <span className="shrink-0 text-[12px] tabular-nums text-muted-foreground">{at}</span>
      </div>
      <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{body}</p>
    </div>
  );
}

export function AdminTicketsPage() {
  const toast = useToast();
  const { can, me } = useAdmin();

  const [stats, setStats] = useState<TicketStats | null>(null);

  /** 顶栏搜索带 `?id=` 跳过来时直接展开该工单 */
  const [searchParams] = useSearchParams();
  const rawUrlTicketStatus = searchParams.get('status');
  const urlTicketStatus =
    rawUrlTicketStatus && TICKET_STATUSES.includes(rawUrlTicketStatus as TicketStatus)
      ? rawUrlTicketStatus
      : undefined;
  const rawUrlType = searchParams.get('type');
  const urlTicketType =
    rawUrlType && Object.prototype.hasOwnProperty.call(TYPE_LABELS, rawUrlType)
      ? rawUrlType
      : undefined;
  const rawUrlPriority = searchParams.get('priority');
  const urlTicketPriority =
    rawUrlPriority && Object.prototype.hasOwnProperty.call(PRIORITY_LABELS, rawUrlPriority)
      ? rawUrlPriority
      : undefined;
  const urlAssigneeId = searchParams.get('assigneeId') ?? undefined;
  const urlQ = searchParams.get('q') ?? '';

  /** 关键词草稿：只有点「查询」或回车才生效，避免失焦与翻页互相抢请求 */
  const [qDraft, setQDraft] = useState(urlQ);
  const appliedUrlStatus = useRef<string | undefined>(urlTicketStatus);
  const [detailId, setDetailId] = useAdminDetailParam();
  const [detail, setDetail] = useState<AdminTicketDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);

  const fetcher = useCallback(
    (params: Record<string, unknown>) =>
      adminTicketsApi.list({
        status: params.status as string | undefined,
        type: params.type as string | undefined,
        priority: params.priority as string | undefined,
        assigneeId: params.assigneeId as string | undefined,
        q: params.q as string | undefined,
        limit: (params.pageSize as number) || 20,
        offset: (((params.page as number) || 1) - 1) * ((params.pageSize as number) || 20),
      }),
    [],
  );

  const { data, loading, error, params, setQuery, setPage, reload } =
    useAdminList<AdminTicketListResult>(fetcher, {
      ...(urlTicketStatus ? { status: urlTicketStatus } : {}),
      ...(urlTicketType ? { type: urlTicketType } : {}),
      ...(urlTicketPriority ? { priority: urlTicketPriority } : {}),
      ...(urlAssigneeId ? { assigneeId: urlAssigneeId } : {}),
      ...(urlQ ? { q: urlQ } : {}),
    });

  /* 告警中心链接 `?status=open`：已在本页时也要把筛选同步过去 */
  useEffect(() => {
    const raw = searchParams.get('status');
    const next = raw && TICKET_STATUSES.includes(raw as TicketStatus) ? raw : undefined;
    if (next === appliedUrlStatus.current) return;
    appliedUrlStatus.current = next;
    // 浏览器后退到无 status 的地址时也要清掉筛选，否则列表与地址栏不一致
    setQuery({ status: next });
  }, [searchParams, setQuery]);

  useAdminUrlFilterSync({
    status: params.status as string | undefined,
    type: params.type as string | undefined,
    priority: params.priority as string | undefined,
    assigneeId: params.assigneeId as string | undefined,
    q: params.q as string | undefined,
  });

  const loadStats = useCallback(() => {
    adminTicketsApi
      .stats()
      .then(setStats)
      .catch(() => {
        /* 统计失败不影响列表, 顶部卡片保持上一次的值 */
      });
  }, []);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  const loadDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    setDetailError(null);
    try {
      setDetail(await adminTicketsApi.detail(id));
    } catch (e) {
      setDetailError(e instanceof Error ? e.message : '工单详情加载失败');
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!detailId) {
      setDetail(null);
      setReply('');
      return;
    }
    void loadDetail(detailId);
  }, [detailId, loadDetail]);

  const refresh = async (id: string) => {
    await loadDetail(id);
    reload();
    loadStats();
  };

  const sendReply = async () => {
    if (!detail) return;
    const text = reply.trim();
    if (!text) {
      toast.warning('请填写回复内容');
      return;
    }
    setBusy(true);
    try {
      await adminTicketsApi.reply(detail.id, text);
      setReply('');
      await refresh(detail.id);
      toast.success('已回复，用户会在站内消息里收到通知');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '回复失败');
    } finally {
      setBusy(false);
    }
  };

  const changeStatus = async (to: TicketStatus) => {
    if (!detail) return;
    setBusy(true);
    try {
      await adminTicketsApi.update(detail.id, { status: to });
      await refresh(detail.id);
      toast.success(`已${transitionLabel(to)}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '状态更新失败');
    } finally {
      setBusy(false);
    }
  };

  const assignSelf = async () => {
    if (!detail || !me) return;
    setBusy(true);
    try {
      await adminTicketsApi.update(detail.id, { assigneeId: me.id });
      await refresh(detail.id);
      toast.success('已认领该工单');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '指派失败');
    } finally {
      setBusy(false);
    }
  };

  const unassign = async () => {
    if (!detail) return;
    setBusy(true);
    try {
      // 显式传 null: 与"不改指派"区分开, 后端靠 undefined/null 区分语义
      await adminTicketsApi.update(detail.id, { assigneeId: null });
      await refresh(detail.id);
      toast.success('已取消指派');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '取消指派失败');
    } finally {
      setBusy(false);
    }
  };

  const changePriority = async (priority: string) => {
    if (!detail) return;
    setBusy(true);
    try {
      await adminTicketsApi.update(detail.id, { priority });
      await refresh(detail.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '优先级更新失败');
    } finally {
      setBusy(false);
    }
  };

  const columns: Array<AdminColumn<AdminTicketRow>> = [
    {
      key: 'subject',
      title: '工单 / 标题',
      width: 280,
      render: (row) => (
        <div className="flex flex-col gap-0.5">
          <button
            type="button"
            className="max-w-[260px] truncate rounded text-left text-brand hover:underline"
            title={row.subject}
            onClick={() => setDetailId(row.id)}
          >
            {row.subject}
          </button>
          <span className="text-[12px] text-muted-foreground">
            <code className="font-mono">{row.ticketNo}</code> ·{' '}
            {row.typeLabel || TYPE_LABELS[row.type]}
          </span>
        </div>
      ),
    },
    {
      key: 'user',
      title: '提交人',
      width: 180,
      render: (row) => (
        <div className="flex flex-col gap-0.5">
          <span>{row.userName || '—'}</span>
          <Link
            className="block max-w-[170px] truncate text-[12px] text-brand hover:underline"
            title={row.userEmail}
            to={adminUserDetailHref(row.userId)}
          >
            {row.userEmail}
          </Link>
        </div>
      ),
    },
    {
      key: 'priority',
      title: '优先级',
      width: 80,
      render: (row) => (
        <StatusTag
          status={row.priority}
          label={PRIORITY_LABELS[row.priority]}
          tone={PRIORITY_TONE[row.priority]}
        />
      ),
    },
    {
      key: 'status',
      title: '状态',
      width: 100,
      render: (row) => (
        <StatusTag
          status={row.status}
          label={STATUS_LABELS[row.status]}
          tone={STATUS_TONE[row.status]}
        />
      ),
    },
    {
      key: 'replyCount',
      title: '回复',
      width: 70,
      align: 'right',
      render: (row) => (
        <span className="tabular-nums text-muted-foreground">{row.replyCount} 条</span>
      ),
    },
    {
      key: 'time',
      title: '提交 / 更新',
      width: 170,
      render: (row) => (
        <div className="flex flex-col gap-0.5 text-[12px] tabular-nums text-muted-foreground">
          <span>{new Date(row.createdAt).toLocaleString('zh-CN')}</span>
          <span>{new Date(row.updatedAt).toLocaleString('zh-CN')}</span>
        </div>
      ),
    },
    {
      key: 'ops',
      title: '',
      width: 90,
      fixed: 'right',
      render: (row) => (
        <ActionButton variant="ghost" size="sm" onClick={() => setDetailId(row.id)}>
          处理
        </ActionButton>
      ),
    },
  ];

  /** 详情里的可执行流转（后端仍会二次校验） */
  const nextStatuses = useMemo(
    () => (detail ? (TRANSITIONS[detail.status as TicketStatus] ?? []) : []),
    [detail],
  );

  const applyKeyword = () => setQuery({ q: qDraft.trim() || undefined });

  const resetFilters = () => {
    appliedUrlStatus.current = undefined;
    setQDraft('');
    setQuery({
      status: undefined,
      type: undefined,
      priority: undefined,
      assigneeId: undefined,
      q: undefined,
    });
  };

  const appliedStatus = params.status as string | undefined;
  const appliedType = params.type as string | undefined;
  const appliedPriority = params.priority as string | undefined;
  const appliedAssignee = params.assigneeId as string | undefined;
  const appliedQ = (params.q as string | undefined) ?? '';
  const appliedChips: AppliedFilter[] = [
    appliedStatus
      ? {
          key: 'status',
          label: `状态：${STATUS_LABELS[appliedStatus as TicketStatus] ?? appliedStatus}`,
          onClear: () => {
            appliedUrlStatus.current = undefined;
            setQuery({ status: undefined });
          },
        }
      : null,
    appliedType
      ? {
          key: 'type',
          label: `类型：${TYPE_LABELS[appliedType as TicketType] ?? appliedType}`,
          onClear: () => setQuery({ type: undefined }),
        }
      : null,
    appliedPriority
      ? {
          key: 'priority',
          label: `优先级：${PRIORITY_LABELS[appliedPriority as TicketPriority] ?? appliedPriority}`,
          onClear: () => setQuery({ priority: undefined }),
        }
      : null,
    appliedAssignee
      ? {
          key: 'assigneeId',
          label:
            appliedAssignee === 'unassigned'
              ? '归属：仅未指派'
              : `处理人：${appliedAssignee}`,
          onClear: () => setQuery({ assigneeId: undefined }),
        }
      : null,
    appliedQ
      ? {
          key: 'q',
          label: `关键词：${appliedQ}`,
          onClear: () => {
            setQDraft('');
            setQuery({ q: undefined });
          },
        }
      : null,
  ].filter(Boolean) as AppliedFilter[];
  const hasFilter = appliedChips.length > 0;

  const replyDirty = detailId !== null && Boolean(reply.trim());
  useUnsavedGuard(replyDirty);
  const requestCloseDetail = useDiscardConfirm(replyDirty, () => setDetailId(null));

  return (
    <>
      <PageHeader
        title="工单处理"
        description="用户提交的问题、投诉与咨询集中在这里。关联订单与素材只读展示，退款与积分补偿请回订单模块执行。"
        actions={
          can('data.export') ? (
            <ActionButton
              variant="secondary"
              icon={Download}
              onClick={() =>
                void adminTicketsApi
                  .exportCsv({
                    status: params.status as string | undefined,
                    type: params.type as string | undefined,
                    priority: params.priority as string | undefined,
                    assigneeId: params.assigneeId as string | undefined,
                    q: params.q as string | undefined,
                  })
                  .catch((e: Error) => toast.error(e.message))
              }
            >
              导出 CSV
            </ActionButton>
          ) : undefined
        }
      />

      <div className="mb-3 grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(170px,1fr))]">
        <StatCard
          label="待处理"
          value={stats?.pending ?? '—'}
          hint="未受理 + 处理中的总量"
          tone={(stats?.pending ?? 0) > 0 ? 'warn' : undefined}
        />
        <StatCard label="待受理" value={stats?.open ?? '—'} hint="尚无人认领" />
        <StatCard label="处理中" value={stats?.processing ?? '—'} hint="已受理，等待结论" />
        <StatCard label="已解决" value={stats?.resolved ?? '—'} hint="等待用户确认或关闭" />
        <StatCard label="已关闭" value={stats?.closed ?? '—'} hint="会话结束" />
      </div>

      {/* 刷新失败但手上还有上一次的数据: 只挂提示, 不把整个列表藏起来 */}
      {error && data && <StaleError error={error} onRetry={reload} />}

      <FilterBar>
        <SelectField
          className="w-32"
          ariaLabel="按状态筛选"
          placeholder="全部状态"
          allowClear
          clearLabel="全部状态"
          value={appliedStatus}
          onChange={(value) => {
            appliedUrlStatus.current = value;
            setQuery({ status: value });
          }}
          options={Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label }))}
        />
        <SelectField
          className="w-32"
          ariaLabel="按类型筛选"
          placeholder="全部类型"
          allowClear
          clearLabel="全部类型"
          value={appliedType}
          onChange={(value) => setQuery({ type: value })}
          options={Object.entries(TYPE_LABELS).map(([value, label]) => ({ value, label }))}
        />
        <SelectField
          className="w-32"
          ariaLabel="按优先级筛选"
          placeholder="全部优先级"
          allowClear
          clearLabel="全部优先级"
          value={appliedPriority}
          onChange={(value) => setQuery({ priority: value })}
          options={[
            { value: 'high', label: '高' },
            { value: 'normal', label: '中' },
            { value: 'low', label: '低' },
          ]}
        />
        <SelectField
          className="w-32"
          ariaLabel="按归属筛选"
          placeholder="全部归属"
          allowClear
          clearLabel="全部归属"
          value={appliedAssignee}
          onChange={(value) => setQuery({ assigneeId: value })}
          options={[{ value: 'unassigned', label: '仅未指派' }]}
        />
        <ClearableField
          className="w-56"
          placeholder="工单号 / 标题 / 正文"
          ariaLabel="工单号 / 标题 / 正文"
          value={qDraft}
          onChange={setQDraft}
          onEnter={applyKeyword}
        />
        <FilterActions>
          <ActionButton variant="default" onClick={applyKeyword}>
            查询
          </ActionButton>
          <ActionButton variant="secondary" onClick={resetFilters}>
            重置
          </ActionButton>
        </FilterActions>
        <AppliedFilters items={appliedChips} onClearAll={resetFilters} />
      </FilterBar>

      <Panel title="工单列表" note="按状态、类型、优先级与关键字筛选">
        <AdminDataTable<AdminTicketRow>
          rows={data?.items ?? []}
          columns={columns}
          rowKey={(row) => row.id}
          loading={loading}
          error={error}
          onRetry={reload}
          minWidth={1000}
          emptyText={hasFilter ? '当前筛选下没有工单。' : '还没有工单。'}
          emptyAction={
            hasFilter ? (
              <ActionButton variant="secondary" onClick={resetFilters}>
                清除筛选
              </ActionButton>
            ) : undefined
          }
          pagination={
            data
              ? {
                  current: (params.page as number) || 1,
                  pageSize: (params.pageSize as number) || 20,
                  total: data.total ?? 0,
                  unit: '张工单',
                  onChange: (page, size) => setPage(page, size),
                }
              : undefined
          }
        />
      </Panel>

      <Drawer
        open={detailId !== null}
        onOpenChange={(next) => {
          if (!next) requestCloseDetail();
        }}
        width={760}
        title={detail ? `${detail.subject} · ${detail.ticketNo}` : '工单详情'}
        description={replyDirty ? '有未发送的回复' : undefined}
      >
        {detailLoading ? (
          /* 抽屉外壳已经是实的，只替内容行 */
          <SkeletonBody rows={4} />
        ) : detailError ? (
          <ListError
            error={detailError}
            onRetry={() => detailId && void loadDetail(detailId)}
          />
        ) : detail ? (
          <div className="flex flex-col gap-4">
            <Descriptions
              columns={2}
              items={[
                {
                  label: '状态',
                  value: (
                    <span className="flex flex-wrap items-center gap-1.5">
                      <StatusTag
                        status={detail.status}
                        label={STATUS_LABELS[detail.status as TicketStatus]}
                        tone={STATUS_TONE[detail.status as TicketStatus]}
                      />
                      <span className="text-[12px] text-muted-foreground">
                        {detail.assigneeId ? '已指派' : '未指派'}
                      </span>
                    </span>
                  ),
                },
                {
                  label: '优先级',
                  value: (
                    <SelectField
                      className="w-24"
                      ariaLabel="优先级"
                      value={detail.priority}
                      disabled={!can('ticket.handle') || busy}
                      onChange={(value) => {
                        if (value) void changePriority(value);
                      }}
                      options={[
                        { value: 'high', label: '高' },
                        { value: 'normal', label: '中' },
                        { value: 'low', label: '低' },
                      ]}
                    />
                  ),
                },
                {
                  label: '提交人',
                  value: (
                    <span className="flex flex-col gap-1">
                      <span className="flex flex-wrap items-center gap-1.5">
                        {detail.user.name || '—'} ·{' '}
                        <Link
                          className="text-brand hover:underline"
                          to={adminUserDetailHref(detail.user.id)}
                        >
                          {detail.user.email}
                        </Link>
                      </span>
                      <span className="flex gap-3 text-[12px]">
                        <Link
                          className="text-brand hover:underline"
                          to={adminCreditHref({
                            userId: detail.user.id,
                            email: detail.user.email,
                          })}
                        >
                          积分账本
                        </Link>
                        <Link
                          className="text-brand hover:underline"
                          to={adminOrderHref({ email: detail.user.email })}
                        >
                          全部订单
                        </Link>
                      </span>
                    </span>
                  ),
                },
                {
                  label: '类型',
                  value: detail.typeLabel || TYPE_LABELS[detail.type],
                },
                {
                  label: '提交时间',
                  value: (
                    <span className="tabular-nums">
                      {new Date(detail.createdAt).toLocaleString('zh-CN')}
                    </span>
                  ),
                },
                ...(detail.resolvedAt
                  ? [
                      {
                        label: '解决时间',
                        value: (
                          <span className="tabular-nums">
                            {new Date(detail.resolvedAt).toLocaleString('zh-CN')}
                          </span>
                        ),
                      },
                    ]
                  : []),
                ...(detail.related.order
                  ? [
                      {
                        label: '关联订单',
                        value: (
                          <span className="flex flex-wrap items-baseline gap-1.5">
                            <Link
                              className="text-brand hover:underline"
                              to={adminOrderDetailHref(detail.related.order.id)}
                            >
                              {detail.related.order.orderNo}
                            </Link>
                            <span className="text-[12px] text-muted-foreground">
                              {detail.related.order.status} · ¥
                              {(detail.related.order.paidCents / 100).toFixed(2)}
                            </span>
                          </span>
                        ),
                      },
                    ]
                  : []),
                ...(detail.related.asset
                  ? [
                      {
                        label: '关联素材',
                        value: (
                          <span className="flex flex-wrap items-baseline gap-1.5">
                            <Link
                              className="text-brand hover:underline"
                              to={adminAssetHref(detail.related.asset.id)}
                            >
                              <code className="font-mono text-xs">
                                {detail.related.asset.id}
                              </code>
                            </Link>
                            <span className="text-[12px] text-muted-foreground">
                              {detail.related.asset.width}×{detail.related.asset.height}
                            </span>
                          </span>
                        ),
                      },
                    ]
                  : []),
              ]}
            />

            <Section title="对话" note={`共 ${detail.replies.length + 1} 条消息`}>
              <div className="flex flex-col gap-2">
                <Message
                  author={detail.user.name || detail.user.email}
                  at={new Date(detail.createdAt).toLocaleString('zh-CN')}
                  body={detail.content}
                />
                {detail.replies.map((r) => (
                  <Message
                    key={r.id}
                    fromAdmin={r.authorType === 'admin'}
                    author={
                      r.authorType === 'admin' ? `客服 · ${r.authorName}` : r.authorName
                    }
                    at={new Date(r.createdAt).toLocaleString('zh-CN')}
                    body={r.content}
                  />
                ))}
                {detail.replies.length === 0 && (
                  <p className="text-[12px] text-muted-foreground">
                    还没有回复。在下方向用户说明处理进展。
                  </p>
                )}
              </div>
            </Section>

            {can('ticket.handle') ? (
              <Section title="回复用户">
                <TextAreaField
                  ariaLabel="回复内容"
                  rows={4}
                  maxLength={2000}
                  showCount
                  value={reply}
                  disabled={busy}
                  onChange={setReply}
                  placeholder="说明处理结论或需要用户补充的信息。回复后用户会在站内消息里收到通知。"
                />
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <ActionButton
                    variant="default"
                    icon={Send}
                    disabled={busy || !reply.trim()}
                    onClick={() => void sendReply()}
                  >
                    发送回复
                  </ActionButton>
                  {!detail.assigneeId && (
                    <ActionButton
                      variant="secondary"
                      icon={UserCheck}
                      disabled={busy}
                      onClick={() => void assignSelf()}
                    >
                      认领
                    </ActionButton>
                  )}
                  {detail.assigneeId && (
                    <ActionButton
                      variant="secondary"
                      disabled={busy}
                      onClick={() => void unassign()}
                    >
                      取消指派
                    </ActionButton>
                  )}
                </div>
              </Section>
            ) : (
              <p className="text-[12px] text-muted-foreground">
                你没有工单处理权限（ticket.handle），当前为只读视图。
              </p>
            )}

            {can('ticket.handle') && nextStatuses.length > 0 && (
              <Section title="状态流转">
                <div className="flex flex-wrap items-center gap-2">
                  {nextStatuses.map((to) => (
                    <ActionButton
                      key={to}
                      variant={to === 'closed' ? 'destructive' : 'secondary'}
                      disabled={busy}
                      onClick={() => void changeStatus(to)}
                    >
                      {transitionLabel(to)}
                    </ActionButton>
                  ))}
                </div>
                <p className="mt-2 text-[12px] text-muted-foreground">
                  关闭后用户无法继续回复，只能新建工单；如问题仍在，可重新打开接回原上下文。
                </p>
              </Section>
            )}
          </div>
        ) : (
          <EmptyState title="暂无工单详情" description="没有可展示的工单详情。" />
        )}
      </Drawer>
    </>
  );
}
