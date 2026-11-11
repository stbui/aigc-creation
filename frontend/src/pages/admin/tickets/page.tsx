import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  AdminPage,
  ActionButton,
  ContextBanner,
  ExportCsvButton,
  Panel,
  SavedViewBar,
  StaleError,
  type AppliedFilter,
} from '~/admin-ui/primitives';
import {
  readAdminActionContext,
  readAdminDone,
} from '../../../lib/admin-context-link';
import { adminTicketsApi } from './api';
import {
  useAdmin,
  useAdminDetailParam,
  useAdminList,
  useAdminUrlFilterSync,
  useDiscardConfirm,
  useToast,
  useAdminExport,
  useUnsavedGuard,
} from './hooks';
import {
  PRIORITY_LABELS,
  STATUS_LABELS,
  STATUS_OPTIONS,
  TICKET_STATUSES,
  TYPE_LABELS,
  TYPE_OPTIONS,
} from './constants';
import { transitionLabel } from './utils';
import { TicketFilterBar, type TicketFilterDraft } from './TicketFilterBar';
import { TicketStatsCards } from './TicketStatsCards';
import { TicketTable } from './TicketTable';
import { TicketDetailDrawer } from './TicketDetailDrawer';
import { TicketTransferDialog } from './TicketTransferDialog';
import type {
  AdminTicketAssignee,
  AdminTicketDetail,
  AdminTicketListResult,
  TicketStats,
  TicketStatus,
  TicketType,
} from '../../../types/api';

/**
 * 工单处理中心。
 *
 * ## 为什么详情用抽屉而不是独立页
 *
 * 客服的动线是「扫列表 → 处理 → 回列表继续下一篇」。独立详情页每次都要
 * 返回并重新定位列表位置；抽屉关掉就回到原来的筛选与页码，一天处理几十单
 * 时这是最大的一处省力。
 *
 * ## 为什么财务动作不在这里
 *
 * 详情里能看到关联订单与素材，但**只能看**。退款、补发积分必须回订单模块 ——
 * 那里有退款时间窗、可退上限、积分回收一整套规则。在工单里再放一个
 * 「顺手退个款」的按钮，两套规则迟早不一致，而差额只有在对账时才会暴露。
 *
 * ## 状态机由后端裁决
 *
 * 前端只按同一份流转表决定**显示哪些按钮**，真正的合法性校验在后端
 * (`TicketsService.TRANSITIONS`)。前端漏判只会看到一个 400 提示，不会写坏数据。
 *
 * ## 模块划分
 *
 * 统计卡 / 列表 / 详情抽屉各自独立；本文件保留筛选、URL 同步与写操作编排。
 */
export function AdminTicketsPage() {
  const toast = useToast();
  const { exporting, runExport } = useAdminExport(toast);
  const { can, me } = useAdmin();

  const [stats, setStats] = useState<TicketStats | null>(null);

  /** 顶栏搜索带 `?id=` 跳过来时直接展开该工单 */
  const [searchParams] = useSearchParams();
  const done = readAdminDone(searchParams);
  const actionContext = readAdminActionContext(searchParams);
  const rawUrlTicketStatus = searchParams.get('status');
  const urlTicketStatus =
    rawUrlTicketStatus && TICKET_STATUSES.includes(rawUrlTicketStatus as TicketStatus) ? rawUrlTicketStatus : undefined;
  const rawUrlType = searchParams.get('type');
  const urlTicketType =
    rawUrlType && Object.prototype.hasOwnProperty.call(TYPE_LABELS, rawUrlType) ? rawUrlType : undefined;
  const rawUrlPriority = searchParams.get('priority');
  const urlTicketPriority =
    rawUrlPriority && Object.prototype.hasOwnProperty.call(PRIORITY_LABELS, rawUrlPriority)
      ? rawUrlPriority
      : undefined;
  const urlAssigneeId = searchParams.get('assigneeId') ?? undefined;
  const urlQ = searchParams.get('q') ?? '';

  /** 关键词草稿：只有点「查询」或回车才生效，避免失焦与翻页互相抢请求 */
  const [qDraft, setQDraft] = useState(urlQ);
  /**
   * 下拉草稿：与关键词同一时机提交。
   *
   * 原先四个下拉是 selected 即 `setQuery`，同一条筛选条里出现了两种提交方式 ——
   * 改下拉立刻刷新，改关键词还要按「查询」，而且「查询」按钮实际上不管下拉。
   * 一条筛选条只留一种时机：都在「查询」/ 回车时提交。
   */
  const [draft, setDraft] = useState<TicketFilterDraft>({
    status: urlTicketStatus,
    type: urlTicketType,
    priority: urlTicketPriority,
    assigneeId: urlAssigneeId,
  });
  const appliedUrlStatus = useRef<string | undefined>(urlTicketStatus);
  const [detailId, setDetailId] = useAdminDetailParam();
  const [detail, setDetail] = useState<AdminTicketDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const [assignees, setAssignees] = useState<AdminTicketAssignee[]>([]);
  const [transferOpen, setTransferOpen] = useState(false);

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

  const { data, loading, error, params, setQuery, setPage, reload } = useAdminList<AdminTicketListResult>(fetcher, {
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
    // 草稿同步跟住地址栏：否则下拉还显示上一次选中的值，与列表对不上
    setDraft((prev) => ({ ...prev, status: next }));
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
        /* 统计失败不影响列表，顶部卡片保持上一次的值 */
      });
  }, []);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  useEffect(() => {
    if (!can('ticket.handle')) return;
    let alive = true;
    adminTicketsApi
      .assignees()
      .then((rows) => {
        if (alive) setAssignees(rows);
      })
      .catch(() => {
        /* 指派候选加载失败不影响列表；详情抽屉仍可认领自己 */
      });
    return () => {
      alive = false;
    };
  }, [can]);

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

  const sendReply = async (visibility: 'public' | 'internal') => {
    if (!detail) return;
    const text = reply.trim();
    if (!text) {
      toast.warning(visibility === 'internal' ? '请填写内部备注' : '请填写回复内容');
      return;
    }
    setBusy(true);
    try {
      await adminTicketsApi.reply(detail.id, text, visibility);
      setReply('');
      await refresh(detail.id);
      toast.success(
        visibility === 'internal'
          ? '内部备注已保存，仅后台可见'
          : '已回复，用户会在站内消息里收到通知',
      );
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
      // 显式传 null：与「不改指派」区分开，后端靠 undefined / null 区分语义
      await adminTicketsApi.update(detail.id, { assigneeId: null });
      await refresh(detail.id);
      toast.success('已取消指派');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '取消指派失败');
    } finally {
      setBusy(false);
    }
  };

  /** 列表行内认领：不打开抽屉，适合客服扫列表时快速接手 */
  const claimRow = async (id: string) => {
    if (!me) return;
    try {
      await adminTicketsApi.update(id, { assigneeId: me.id });
      toast.success('已认领该工单');
      reload();
      loadStats();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '认领失败');
    }
  };

  const assignTo = async (assigneeId: string) => {
    if (!detail) return;
    setBusy(true);
    try {
      await adminTicketsApi.update(detail.id, { assigneeId });
      await refresh(detail.id);
      toast.success('已指派处理人');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '指派失败');
    } finally {
      setBusy(false);
    }
  };

  const transferTicket = async (assigneeId: string, note: string) => {
    if (!detail) return;
    setBusy(true);
    try {
      await adminTicketsApi.transfer(detail.id, assigneeId, note);
      setTransferOpen(false);
      await refresh(detail.id);
      toast.success('已转交；接收人可在工作台看到该工单');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '转交失败');
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

  const applyFilters = () => {
    appliedUrlStatus.current = draft.status;
    setQuery({
      status: draft.status,
      type: draft.type,
      priority: draft.priority,
      assigneeId: draft.assigneeId,
      q: qDraft.trim() || undefined,
    });
  };

  const resetFilters = () => {
    appliedUrlStatus.current = undefined;
    setQDraft('');
    setDraft({ status: undefined, type: undefined, priority: undefined, assigneeId: undefined });
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
            setDraft((prev) => ({ ...prev, status: undefined }));
            setQuery({ status: undefined });
          },
        }
      : null,
    appliedType
      ? {
          key: 'type',
          label: `类型：${TYPE_LABELS[appliedType as TicketType] ?? appliedType}`,
          onClear: () => {
            setDraft((prev) => ({ ...prev, type: undefined }));
            setQuery({ type: undefined });
          },
        }
      : null,
    appliedPriority
      ? {
          key: 'priority',
          label: `优先级：${PRIORITY_LABELS[appliedPriority as keyof typeof PRIORITY_LABELS] ?? appliedPriority}`,
          onClear: () => {
            setDraft((prev) => ({ ...prev, priority: undefined }));
            setQuery({ priority: undefined });
          },
        }
      : null,
    appliedAssignee
      ? {
          key: 'assigneeId',
          label: appliedAssignee === 'unassigned' ? '归属：仅未指派' : `处理人：${appliedAssignee}`,
          onClear: () => {
            setDraft((prev) => ({ ...prev, assigneeId: undefined }));
            setQuery({ assigneeId: undefined });
          },
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

  const listIds = (data?.items ?? []).map((item) => item.id);
  const listIndex = detailId ? listIds.indexOf(detailId) : -1;
  const openAdjacent = (offset: number) => {
    const next = listIds[listIndex + offset];
    if (next) setDetailId(next);
  };

  return (
    <AdminPage
      title="工单处理"
      description="用户提交的问题、投诉与咨询集中在这里。关联订单与素材只读展示，退款与积分补偿请回订单模块执行。"
      actions={
        can('data.export') ? (
          <ExportCsvButton
            exporting={exporting}
            onExport={() =>
              runExport(() =>
                adminTicketsApi.exportCsv({
                  status: params.status as string | undefined,
                  type: params.type as string | undefined,
                  priority: params.priority as string | undefined,
                  assigneeId: params.assigneeId as string | undefined,
                  q: params.q as string | undefined,
                }),
              )
            }
          />
        ) : undefined
      }
    >

      <TicketStatsCards stats={stats} />

      {/* 刷新失败但手上还有上一次的数据：只挂提示，不把整个列表藏起来 */}
      {error && data && <StaleError error={error} onRetry={reload} />}

      <TicketFilterBar
        draft={draft}
        onDraftChange={(patch) => setDraft((prev) => ({ ...prev, ...patch }))}
        keyword={qDraft}
        onKeywordChange={setQDraft}
        chips={appliedChips}
        onApply={applyFilters}
        onReset={resetFilters}
      />

      <SavedViewBar
        pageKey="tickets"
        currentFilters={{
          status: appliedStatus,
          type: appliedType,
          priority: appliedPriority,
          assigneeId: appliedAssignee,
          q: appliedQ || undefined,
        }}
        onApply={(filters) => {
          appliedUrlStatus.current = filters.status;
          setQDraft(filters.q ?? '');
          setQuery({
            status: filters.status,
            type: filters.type,
            priority: filters.priority,
            assigneeId: filters.assigneeId,
            q: filters.q,
          });
        }}
      />

      <Panel title="工单列表" note="按状态、类型、优先级与关键字筛选">
        <TicketTable
          rows={data?.items ?? []}
          loading={loading}
          error={error}
          hasFilter={hasFilter}
          current={(params.page as number) || 1}
          pageSize={(params.pageSize as number) || 20}
          total={data?.total ?? 0}
          onRetry={reload}
          onResetFilters={resetFilters}
          onOpen={setDetailId}
          canClaim={can('ticket.handle')}
          onClaim={(id) => void claimRow(id)}
          onPageChange={(page, size) => setPage(page, size)}
        />
      </Panel>

      <TicketDetailDrawer
        open={detailId !== null}
        detail={detail}
        loading={detailLoading}
        error={detailError}
        reply={reply}
        busy={busy}
        canHandle={can('ticket.handle')}
        canRefund={can('order.refund')}
        replyDirty={replyDirty}
        assignees={assignees}
        hasPrev={listIndex > 0}
        hasNext={listIndex >= 0 && listIndex < listIds.length - 1}
        onClose={requestCloseDetail}
        onRetry={() => {
          if (detailId) void loadDetail(detailId);
        }}
        onReplyChange={setReply}
        onSendReply={(visibility) => void sendReply(visibility)}
        onChangeStatus={(to) => void changeStatus(to)}
        onChangePriority={(priority) => void changePriority(priority)}
        onAssign={(assigneeId) => void assignTo(assigneeId)}
        onAssignSelf={() => void assignSelf()}
        onUnassign={() => void unassign()}
        onOpenTransfer={() => setTransferOpen(true)}
        onPrev={() => openAdjacent(-1)}
        onNext={() => openAdjacent(1)}
      />

      {detail && (
        <TicketTransferDialog
          open={transferOpen}
          ticketNo={detail.ticketNo}
          assignees={assignees}
          defaultAssigneeId={detail.assigneeId}
          loading={busy}
          onCancel={() => setTransferOpen(false)}
          onConfirm={(assigneeId, note) => void transferTicket(assigneeId, note)}
        />
      )}
    </AdminPage>
  );
}
