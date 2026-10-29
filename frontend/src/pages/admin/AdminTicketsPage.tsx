import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { App, Button, Drawer, Input, Select, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { Link, useSearchParams } from 'react-router-dom';
import { Download, Send, UserCheck } from 'lucide-react';
import { adminTicketsApi } from '../../lib/api';
import { useAdmin } from '../../context/AdminContext';
import {
  AdminListError,
  AdminStaleError,
  AdminListLoading,
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
  Panel,
  StatCard,
  StatusTag,
  type AppliedFilter,
} from '../../components/admin/PageHeader';
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

const STATUS_TONES: Record<TicketStatus, string> = {
  open: 'warning',
  processing: 'processing',
  resolved: 'success',
  closed: 'default',
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

export function AdminTicketsPage() {
  const { message } = App.useApp();
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
    useAdminList<{ items: AdminTicketRow[]; total: number; counts: Record<string, number> }>(
      fetcher,
      {
        ...(urlTicketStatus ? { status: urlTicketStatus } : {}),
        ...(urlTicketType ? { type: urlTicketType } : {}),
        ...(urlTicketPriority ? { priority: urlTicketPriority } : {}),
        ...(urlAssigneeId ? { assigneeId: urlAssigneeId } : {}),
        ...(urlQ ? { q: urlQ } : {}),
      },
    );

  /* 告警中心链接 `?status=open`：已在本页时也要把筛选同步过去 */
  useEffect(() => {
    const raw = searchParams.get('status');
    const next =
      raw && TICKET_STATUSES.includes(raw as TicketStatus) ? raw : undefined;
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
      void message.warning('请填写回复内容');
      return;
    }
    setBusy(true);
    try {
      await adminTicketsApi.reply(detail.id, text);
      setReply('');
      await refresh(detail.id);
      void message.success('已回复，用户会在站内消息里收到通知');
    } catch (e) {
      void message.error(e instanceof Error ? e.message : '回复失败');
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
      void message.success(`已${transitionLabel(to)}`);
    } catch (e) {
      void message.error(e instanceof Error ? e.message : '状态更新失败');
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
      void message.success('已认领该工单');
    } catch (e) {
      void message.error(e instanceof Error ? e.message : '指派失败');
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
      void message.success('已取消指派');
    } catch (e) {
      void message.error(e instanceof Error ? e.message : '取消指派失败');
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
      void message.error(e instanceof Error ? e.message : '优先级更新失败');
    } finally {
      setBusy(false);
    }
  };

  const columns: ColumnsType<AdminTicketRow> = [
    {
      title: '工单 / 标题',
      key: 'subject',
      width: 280,
      render: (_: unknown, row) => (
        <div className="adm-cell-stack">
          <span className="adm-cell-clip" title={row.subject}>
            {row.subject}
          </span>
          <span className="adm-cell-sub">
            <code>{row.ticketNo}</code> · {row.typeLabel || TYPE_LABELS[row.type]}
          </span>
        </div>
      ),
    },
    {
      title: '提交人',
      key: 'user',
      width: 180,
      render: (_: unknown, row) => (
        <div className="adm-cell-stack">
          <span>{row.userName || '—'}</span>
          <span className="adm-cell-sub adm-cell-clip" title={row.userEmail}>
            <Link className="adm-link" to={adminUserDetailHref(row.userId)}>
              {row.userEmail}
            </Link>
          </span>
        </div>
      ),
    },
    {
      title: '优先级',
      dataIndex: 'priority',
      key: 'priority',
      width: 80,
      render: (v: TicketPriority) => (
        <StatusTag status={v === 'high' ? 'failed' : v === 'low' ? 'default' : 'processing'} label={PRIORITY_LABELS[v]} />
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (v: TicketStatus) => (
        <StatusTag status={STATUS_TONES[v]} label={STATUS_LABELS[v]} />
      ),
    },
    {
      title: '回复',
      dataIndex: 'replyCount',
      key: 'replyCount',
      width: 70,
      render: (v: number) => <span className="adm-cell-sub">{v} 条</span>,
    },
    {
      title: '提交 / 更新',
      key: 'time',
      width: 170,
      render: (_: unknown, row) => (
        <div className="adm-cell-stack">
          <span className="adm-cell-sub">{new Date(row.createdAt).toLocaleString('zh-CN')}</span>
          <span className="adm-cell-sub">{new Date(row.updatedAt).toLocaleString('zh-CN')}</span>
        </div>
      ),
    },
    {
      title: '',
      key: 'ops',
      width: 90,
      render: (_: unknown, row) => (
        <div className="adm-ops">
          <Button type="link" className="adm-link" onClick={() => setDetailId(row.id)}>
            处理
          </Button>
        </div>
      ),
    },
  ];

  /** 详情里的可执行流转（后端仍会二次校验） */
  const nextStatuses = useMemo(
    () => (detail ? TRANSITIONS[detail.status as TicketStatus] ?? [] : []),
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
      />

      <div className="adm-stat-grid">
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
      {error && data && <AdminStaleError error={error} onRetry={reload} />}

      <Panel title="工单列表" note="按状态、类型、优先级与关键字筛选">
        <FilterBar>
          <Select
            className="adm-filter-select"
            placeholder="全部状态"
            allowClear
            value={(params.status as string) || undefined}
            onChange={(v) => {
              appliedUrlStatus.current = v;
              setQuery({ status: v });
            }}
            options={[
              { value: 'open', label: '待处理' },
              { value: 'processing', label: '处理中' },
              { value: 'resolved', label: '已解决' },
              { value: 'closed', label: '已关闭' },
            ]}
          />
          <Select
            className="adm-filter-select"
            placeholder="全部类型"
            allowClear
            value={(params.type as string) || undefined}
            onChange={(v) => setQuery({ type: v })}
            options={Object.entries(TYPE_LABELS).map(([value, label]) => ({ value, label }))}
          />
          <Select
            className="adm-filter-select"
            placeholder="全部优先级"
            allowClear
            value={(params.priority as string) || undefined}
            onChange={(v) => setQuery({ priority: v })}
            options={[
              { value: 'high', label: '高' },
              { value: 'normal', label: '中' },
              { value: 'low', label: '低' },
            ]}
          />
          <Select
            className="adm-filter-select"
            placeholder="全部归属"
            allowClear
            value={(params.assigneeId as string) || undefined}
            onChange={(v) => setQuery({ assigneeId: v })}
            options={[{ value: 'unassigned', label: '仅未指派' }]}
          />
          <Input
            className="adm-filter-input"
            placeholder="工单号 / 标题 / 正文"
            allowClear
            value={qDraft}
            onChange={(e) => setQDraft(e.target.value)}
            onPressEnter={applyKeyword}
          />
          <FilterActions>
            <Button type="primary" className="adm-btn is-primary" onClick={applyKeyword}>
              查询
            </Button>
            <Button type="default" className="adm-btn" onClick={resetFilters}>
              重置
            </Button>
            {can('data.export') && (
              <Button
                type="default"
                className="adm-btn"
                onClick={() =>
                  void adminTicketsApi
                    .exportCsv({
                      status: params.status as string | undefined,
                      type: params.type as string | undefined,
                      priority: params.priority as string | undefined,
                      assigneeId: params.assigneeId as string | undefined,
                      q: params.q as string | undefined,
                    })
                    .catch((e: Error) => message.error(e.message))
                }
              >
                <Download size={14} style={{ marginRight: 4 }} />
                导出
              </Button>
            )}
          </FilterActions>
          <AppliedFilters items={appliedChips} onClearAll={resetFilters} />
        </FilterBar>

        {loading && !data ? (
          <AdminListLoading tip="加载工单…" />
        ) : error && !data ? (
          <AdminListError error={error} onRetry={reload} />
        ) : (data?.items.length ?? 0) === 0 ? (
          <AdminEmpty
            description={hasFilter ? '当前筛选下没有工单。' : '还没有工单。'}
            action={
              hasFilter ? (
                <Button type="default" className="adm-btn" onClick={resetFilters}>
                  清除筛选
                </Button>
              ) : undefined
            }
          />
        ) : (
          <Table<AdminTicketRow>
            rowKey="id"
            size="small"
            columns={columns}
            dataSource={data?.items ?? []}
            loading={loading}
            scroll={{ x: 1000 }}
            pagination={adminPagination({
              current: (params.page as number) || 1,
              pageSize: (params.pageSize as number) || 20,
              total: data?.total ?? 0,
              onChange: setPage,
            })}
          />
        )}
      </Panel>

      <Drawer
        title={detail ? `${detail.subject} · ${detail.ticketNo}` : '工单详情'}
        size={760}
        open={detailId !== null}
        onClose={requestCloseDetail}
        className="adm-drawer"
        destroyOnHidden
      >
        {detailLoading ? (
          <AdminListLoading tip="加载工单详情…" />
        ) : detailError ? (
          <AdminListError error={detailError} onRetry={() => detailId && void loadDetail(detailId)} />
        ) : detail ? (
          <>
            <dl className="adm-desc">
              <dt>状态</dt>
              <dd>
                <StatusTag
                  status={STATUS_TONES[detail.status as TicketStatus]}
                  label={STATUS_LABELS[detail.status as TicketStatus]}
                />
                {detail.assigneeId ? (
                  <span className="adm-cell-sub"> · 已指派</span>
                ) : (
                  <span className="adm-cell-sub"> · 未指派</span>
                )}
              </dd>
              <dt>提交人</dt>
              <dd>
                <div>
                  {detail.user.name || '—'} ·{' '}
                  <Link className="adm-link" to={adminUserDetailHref(detail.user.id)}>
                    {detail.user.email}
                  </Link>
                </div>
                <div className="adm-relation-links">
                  <Link
                    to={adminCreditHref({ userId: detail.user.id, email: detail.user.email })}
                  >
                    积分账本
                  </Link>
                  <Link to={adminOrderHref({ email: detail.user.email })}>全部订单</Link>
                </div>
              </dd>
              <dt>类型</dt>
              <dd>{detail.typeLabel || TYPE_LABELS[detail.type]}</dd>
              <dt>优先级</dt>
              <dd>
                <Select
                  size="small"
                  value={detail.priority}
                  style={{ width: 90 }}
                  disabled={!can('ticket.handle') || busy}
                  onChange={(v) => void changePriority(v)}
                  options={[
                    { value: 'high', label: '高' },
                    { value: 'normal', label: '中' },
                    { value: 'low', label: '低' },
                  ]}
                />
              </dd>
              <dt>提交时间</dt>
              <dd>{new Date(detail.createdAt).toLocaleString('zh-CN')}</dd>
              {detail.resolvedAt && (
                <>
                  <dt>解决时间</dt>
                  <dd>{new Date(detail.resolvedAt).toLocaleString('zh-CN')}</dd>
                </>
              )}
              {detail.related.order && (
                <>
                  <dt>关联订单</dt>
                  <dd>
                    <Link
                      className="adm-link"
                      to={adminOrderDetailHref(detail.related.order.id)}
                    >
                      {detail.related.order.orderNo}
                    </Link>{' '}
                    <span className="adm-cell-sub">
                      {detail.related.order.status} · ¥
                      {(detail.related.order.paidCents / 100).toFixed(2)}
                    </span>
                  </dd>
                </>
              )}
              {detail.related.asset && (
                <>
                  <dt>关联素材</dt>
                  <dd>
                    <Link className="adm-link" to={adminAssetHref(detail.related.asset.id)}>
                      <code>{detail.related.asset.id}</code>
                    </Link>{' '}
                    <span className="adm-cell-sub">
                      {detail.related.asset.width}×{detail.related.asset.height}
                    </span>
                  </dd>
                </>
              )}
            </dl>

            <div className="adm-section">
              <div className="adm-section-title">对话</div>
              <div className="adm-ticket-thread">
                <div className="adm-ticket-msg is-user">
                  <div className="adm-ticket-msg-head">
                    <span>{detail.user.name || detail.user.email}</span>
                    <span className="adm-cell-sub">
                      {new Date(detail.createdAt).toLocaleString('zh-CN')}
                    </span>
                  </div>
                  <div className="adm-ticket-msg-body">{detail.content}</div>
                </div>
                {detail.replies.map((r) => (
                  <div
                    key={r.id}
                    className={`adm-ticket-msg${r.authorType === 'admin' ? ' is-admin' : ' is-user'}`}
                  >
                    <div className="adm-ticket-msg-head">
                      <span>
                        {r.authorType === 'admin' ? `客服 · ${r.authorName}` : r.authorName}
                      </span>
                      <span className="adm-cell-sub">
                        {new Date(r.createdAt).toLocaleString('zh-CN')}
                      </span>
                    </div>
                    <div className="adm-ticket-msg-body">{r.content}</div>
                  </div>
                ))}
                {detail.replies.length === 0 && (
                  <p className="adm-cell-sub">还没有回复。在下方向用户说明处理进展。</p>
                )}
              </div>
            </div>

            {can('ticket.handle') ? (
              <div className="adm-section">
                <div className="adm-section-title">回复用户</div>
                <Input.TextArea
                  rows={4}
                  maxLength={2000}
                  showCount
                  value={reply}
                  disabled={busy}
                  onChange={(e) => setReply(e.target.value)}
                  placeholder="说明处理结论或需要用户补充的信息。回复后用户会在站内消息里收到通知。"
                />
                <div className="adm-ops" style={{ marginTop: 12 }}>
                  <Button
                    type="primary"
                    className="adm-btn is-primary"
                    disabled={busy || !reply.trim()}
                    onClick={() => void sendReply()}
                  >
                    <Send size={14} style={{ marginRight: 4 }} />
                    发送回复
                  </Button>
                  {!detail.assigneeId && (
                    <Button type="default" className="adm-btn" disabled={busy} onClick={() => void assignSelf()}>
                      <UserCheck size={14} style={{ marginRight: 4 }} />
                      认领
                    </Button>
                  )}
                  {detail.assigneeId && (
                    <Button type="default" className="adm-btn" disabled={busy} onClick={() => void unassign()}>
                      取消指派
                    </Button>
                  )}
                </div>
              </div>
            ) : (
              <p className="adm-cell-sub">你没有工单处理权限（ticket.handle），当前为只读视图。</p>
            )}

            {can('ticket.handle') && nextStatuses.length > 0 && (
              <div className="adm-section">
                <div className="adm-section-title">状态流转</div>
                <div className="adm-ops">
                  {nextStatuses.map((to) => (
                    <Button
                      key={to}
                      type="default"
                      className={`adm-btn${to === 'closed' ? ' is-danger' : ''}`}
                      disabled={busy}
                      onClick={() => void changeStatus(to)}
                    >
                      {transitionLabel(to)}
                    </Button>
                  ))}
                </div>
                <p className="adm-cell-sub" style={{ marginTop: 8 }}>
                  关闭后用户无法继续回复，只能新建工单；如问题仍在，可重新打开接回原上下文。
                </p>
              </div>
            )}
          </>
        ) : (
          <AdminEmpty description="没有可展示的工单详情。" />
        )}
      </Drawer>
    </>
  );
}
