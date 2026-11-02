import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Download } from 'lucide-react';
import {
  ActionButton,
  AppliedFilters,
  ClearableField,
  FilterActions,
  FilterBar,
  PageHeader,
  Panel,
  SelectField,
  StaleError,
  type AppliedFilter,
} from './components';
import { adminTicketsApi } from './api';
import {
  useAdmin,
  useAdminDetailParam,
  useAdminList,
  useAdminUrlFilterSync,
  useDiscardConfirm,
  useToast,
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
import { TicketStatsCards } from './TicketStatsCards';
import { TicketTable } from './TicketTable';
import { TicketDetailDrawer } from './TicketDetailDrawer';
import type {
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
        /* 统计失败不影响列表，顶部卡片保持上一次的值 */
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
          label: `优先级：${PRIORITY_LABELS[appliedPriority as keyof typeof PRIORITY_LABELS] ?? appliedPriority}`,
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

      <TicketStatsCards stats={stats} />

      {/* 刷新失败但手上还有上一次的数据：只挂提示，不把整个列表藏起来 */}
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
          options={STATUS_OPTIONS}
        />
        <SelectField
          className="w-32"
          ariaLabel="按类型筛选"
          placeholder="全部类型"
          allowClear
          clearLabel="全部类型"
          value={appliedType}
          onChange={(value) => setQuery({ type: value })}
          options={TYPE_OPTIONS}
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
        replyDirty={replyDirty}
        onClose={requestCloseDetail}
        onRetry={() => {
          if (detailId) void loadDetail(detailId);
        }}
        onReplyChange={setReply}
        onSendReply={() => void sendReply()}
        onChangeStatus={(to) => void changeStatus(to)}
        onChangePriority={(priority) => void changePriority(priority)}
        onAssignSelf={() => void assignSelf()}
        onUnassign={() => void unassign()}
      />
    </>
  );
}
