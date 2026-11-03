import { useCallback, useState } from 'react';
import { adminBillingOrdersApi } from './api';
import { ActionButton, PageHeader, Panel, StaleError, type AppliedFilter } from './components';
import {
  useAdmin,
  useAdminDetailParam,
  useAdminList,
  useAdminResource,
  useToast,
} from './hooks';
import { STATUS_LABELS, REVIEW_OPTION } from './constants';
import { toCredits } from './utils';
import { auditReason } from '../../../admin-ui/lib/auditReason';
import { BillingStats } from './BillingStats';
import { BillingFilterBar } from './BillingFilterBar';
import { BillingOrderTable } from './BillingOrderTable';
import { BillingDetailDrawer } from './BillingDetailDrawer';
import { BatchResolveDrawer } from './BatchResolveDrawer';
import type { BillingOrderListResult, BillingOrderView } from '../../../types/model';

/**
 * 生成账单（`/admin/billing-orders`）。
 *
 * 一次生成任务对应一条账单，状态 `reserved → running → settled | refunded`，
 * 另有 `uncertain`（结果不明，既不切线也不退款，等人工核对）。
 *
 * 人工核对只做两件事：`settle`（按现有用量结算）与 `refund`（全额退回）。
 * 金额口径完全由 `BillingService.resolve` 决定，本页不重算任何金额 ——
 * 「后台自己改库、假装退过钱」是最不能出现的一种错。
 *
 * ## 模块划分
 *
 * 统计条 / 筛选条 / 列表 / 详情核对 / 批量核对各自独立；本文件只保留
 * 取数、筛选状态与写操作编排。
 */
export function AdminBillingOrdersPage() {
  const { can } = useAdmin();
  const toast = useToast();
  const resolvable = can('billing_order.resolve');

  const [status, setStatus] = useState<string | undefined>(undefined);
  const [billingMode, setBillingMode] = useState<string | undefined>(undefined);
  const [model, setModel] = useState('');
  const [userId, setUserId] = useState('');
  const [taskId, setTaskId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const fetcher = useCallback(
    (params: Record<string, unknown>) =>
      adminBillingOrdersApi.list({
        status: params.status as string | undefined,
        billingMode: params.billingMode as string | undefined,
        model: params.model as string | undefined,
        userId: params.userId as string | undefined,
        taskId: params.taskId as string | undefined,
        from: params.from as string | undefined,
        to: params.to as string | undefined,
        page: params.page as number,
        pageSize: params.pageSize as number,
      }),
    [],
  );

  const { data, loading, error, params, setQuery, setPage, reload } = useAdminList<BillingOrderListResult>(fetcher);
  const rows = data?.items ?? [];
  const statusCounts = data?.statusCounts ?? {};

  const [detailId, setDetailId] = useAdminDetailParam();
  // 深链 `?id=` 可能不在当前页：列表命中直接复用，否则单独拉一次详情
  const { data: fetchedDetail } = useAdminResource(
    () => (detailId ? adminBillingOrdersApi.get(detailId) : Promise.resolve(null)),
    [detailId],
  );
  const detail = fetchedDetail ?? rows.find((row) => row.id === detailId) ?? null;
  const [action, setAction] = useState<'settle' | 'refund'>('settle');
  const [resolving, setResolving] = useState(false);
  // 批量核对：勾选若干账单一次性处置，逐条结果回显
  const [selected, setSelected] = useState<string[]>([]);
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchResults, setBatchResults] = useState<
    Array<{ id: string; ok: boolean; error?: string }> | null
  >(null);

  const requestCloseDetail = () => {
    setDetailId(null);
    setAction('settle');
  };

  const openDetail = useCallback(
    (row: BillingOrderView) => {
      setAction('settle');
      setDetailId(row.id);
    },
    [setDetailId],
  );

  const applyFilters = () =>
    setQuery({
      status,
      billingMode,
      model: model.trim() || undefined,
      userId: userId.trim() || undefined,
      taskId: taskId.trim() || undefined,
      from: from || undefined,
      to: to || undefined,
    });

  const resetFilters = () => {
    setStatus(undefined);
    setBillingMode(undefined);
    setModel('');
    setUserId('');
    setTaskId('');
    setFrom('');
    setTo('');
    setQuery({
      status: undefined,
      billingMode: undefined,
      model: undefined,
      userId: undefined,
      taskId: undefined,
      from: undefined,
      to: undefined,
    });
  };

  const runResolve = async () => {
    if (!detail) return;
    setResolving(true);
    try {
      const next = await adminBillingOrdersApi.resolve(
        detail.id,
        action,
        auditReason(action === 'refund' ? '账单核对退款' : '账单按用量结算'),
      );
      toast.success(
        action === 'refund'
          ? `已全额退款：${toCredits(next.refundedAmountMicrocredits)} 积分`
          : `已按现有用量结算：${toCredits(next.actualAmountMicrocredits)} 积分`,
      );
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '核对失败');
    } finally {
      setResolving(false);
    }
  };

  /** 批量核对：逐条独立处置，失败的条目带原因回显 */
  const runBatchResolve = async () => {
    if (selected.length === 0) return;
    setBatchBusy(true);
    setBatchResults(null);
    try {
      const result = await adminBillingOrdersApi.batchResolve(
        selected,
        action,
        auditReason(action === 'refund' ? '批量账单核对退款' : '批量账单按用量结算'),
      );
      setBatchResults(result.results);
      if (result.failed === 0) {
        toast.success(`已核对 ${result.resolved} 条账单`);
        setSelected([]);
      } else {
        toast.error(`已核对 ${result.resolved} 条，${result.failed} 条失败（见下方明细）`);
      }
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '批量核对失败');
    } finally {
      setBatchBusy(false);
    }
  };

  const appliedStatus = params.status as string | undefined;
  const appliedKeyword = params.model as string | undefined;
  const appliedUserId = params.userId as string | undefined;

  const appliedChips: AppliedFilter[] = [
    appliedStatus
      ? {
          key: 'status',
          label: `状态：${appliedStatus === 'review' ? REVIEW_OPTION.label : (STATUS_LABELS[appliedStatus] ?? appliedStatus)}`,
          onClear: () => {
            setStatus(undefined);
            setQuery({ status: undefined });
          },
        }
      : null,
    appliedKeyword
      ? {
          key: 'model',
          label: `模型：${appliedKeyword}`,
          onClear: () => {
            setModel('');
            setQuery({ model: undefined });
          },
        }
      : null,
    appliedUserId
      ? {
          key: 'userId',
          label: `用户：${appliedUserId}`,
          onClear: () => {
            setUserId('');
            setQuery({ userId: undefined });
          },
        }
      : null,
  ].filter(Boolean) as AppliedFilter[];

  return (
    <>
      <PageHeader
        title="生成账单"
        description="一次任务一条账单。人工核对只做结算或全额退款，金额口径完全由计费服务决定。"
      />

      <BillingStats counts={statusCounts} />

      <BillingFilterBar
        status={status}
        onStatusChange={setStatus}
        billingMode={billingMode}
        onBillingModeChange={setBillingMode}
        model={model}
        onModelChange={setModel}
        userId={userId}
        onUserIdChange={setUserId}
        taskId={taskId}
        onTaskIdChange={setTaskId}
        from={from}
        onFromChange={setFrom}
        to={to}
        onToChange={setTo}
        appliedChips={appliedChips}
        onApply={applyFilters}
        onReset={resetFilters}
      />

      <Panel title="账单列表" note="「结果不明」既不切线也不退款，需要人工核对后落到结算或退款。">
        {error && rows.length > 0 && <StaleError error={error} onRetry={() => void reload()} />}
        {resolvable && selected.length > 0 && (
          <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-accent px-3 py-2">
            <span className="text-xs font-medium text-accent-foreground">
              已选 {selected.length} 条账单
            </span>
            <ActionButton
              variant="secondary"
              size="sm"
              disabled={batchBusy}
              onClick={() => {
                setBatchReason('');
                setBatchResults(null);
                setBatchOpen(true);
              }}
            >
              批量核对
            </ActionButton>
            <ActionButton variant="ghost" size="sm" onClick={() => setSelected([])}>
              取消选择
            </ActionButton>
          </div>
        )}
        <BillingOrderTable
          rows={rows}
          loading={loading}
          error={error}
          onRetry={() => void reload()}
          onOpenDetail={openDetail}
          selectable={resolvable}
          selected={selected}
          onSelectedChange={setSelected}
          pagination={{
            current: Number(params.page ?? 1),
            pageSize: Number(params.pageSize ?? 20),
            total: data?.total ?? 0,
            onChange: (page, pageSize) => setPage(page, pageSize),
          }}
        />
      </Panel>

      <BatchResolveDrawer
        open={batchOpen}
        count={selected.length}
        action={action}
        onActionChange={setAction}
        busy={batchBusy}
        results={batchResults}
        onClose={() => setBatchOpen(false)}
        onConfirm={() => void runBatchResolve()}
      />

      <BillingDetailDrawer
        open={detailId !== null}
        detail={detail}
        resolvable={resolvable}
        action={action}
        onActionChange={setAction}
        resolving={resolving}
        onClose={requestCloseDetail}
        onResolve={() => void runResolve()}
      />
    </>
  );
}
