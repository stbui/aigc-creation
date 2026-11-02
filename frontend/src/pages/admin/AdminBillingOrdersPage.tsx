import { useCallback, useMemo, useState } from 'react';
import {
  ActionButton,
  AdminDataTable,
  AppliedFilters,
  Descriptions,
  Drawer,
  FilterActions,
  FilterBar,
  Notice,
  PageHeader,
  Panel,
  SelectField,
  StatCard,
  StatusTag,
  StaleError,
  TextAreaField,
  TextField,
  useAdminDetailParam,
  useAdminList,
  useAdminResource,
  type AdminColumn,
  type AppliedFilter,
} from '../../admin-ui/primitives';
import { adminBillingOrdersApi } from '../../lib/api';
import { useAdmin } from '../../context/AdminContext';
import { useToast } from '../../admin-ui/providers/ToastProvider';
import { useDiscardConfirm, useUnsavedGuard } from '../../hooks/useUnsavedGuard';
import { toCredits, toCreditsInput } from '../../lib/microcredits';
import type { BillingOrderListResult, BillingOrderView } from '../../types/model';

/**
 * 生成账单（`/admin/billing-orders`）。
 *
 * 一次生成任务对应一条账单，状态 `reserved → running → settled | refunded`，
 * 另有 `uncertain`（结果不明，既不切线也不退款，等人工核对）。
 *
 * 人工核对只做两件事：`settle`（按现有用量结算）与 `refund`（全额退回）。
 * 金额口径完全由 `BillingService.resolve` 决定，本页不重算任何金额 ——
 * 「后台自己改库、假装退过钱」是最不能出现的一种错。
 */

const STATUS_LABELS: Record<string, string> = {
  reserved: '已预留',
  running: '计费中',
  settled: '已结算',
  refunded: '已退款',
  uncertain: '结果不明',
};

const STATUS_TONES: Record<string, 'success' | 'danger' | 'warn' | 'brand' | 'muted'> = {
  reserved: 'brand',
  running: 'brand',
  settled: 'success',
  refunded: 'warn',
  uncertain: 'danger',
};

const STATUS_OPTIONS = Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label }));

const BILLING_MODE_LABELS: Record<string, string> = {
  fixed_request: '按次',
  per_second: '按秒',
  token: '按 Token',
};

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
  const [reason, setReason] = useState('');
  const [resolving, setResolving] = useState(false);

  const actionDirty = detailId !== null && reason.trim() !== '';
  useUnsavedGuard(actionDirty);
  const requestCloseDetail = useDiscardConfirm(actionDirty, () => {
    setDetailId(null);
    setReason('');
    setAction('settle');
  });

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
    if (!reason.trim()) {
      toast.error('请填写核对依据');
      return;
    }
    setResolving(true);
    try {
      const next = await adminBillingOrdersApi.resolve(detail.id, action, reason.trim());
      toast.success(
        action === 'refund'
          ? `已全额退款：${toCredits(next.refundedAmountMicrocredits)} 积分`
          : `已按现有用量结算：${toCredits(next.actualAmountMicrocredits)} 积分`,
      );
      setReason('');
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '核对失败');
    } finally {
      setResolving(false);
    }
  };

  const appliedKeyword = params.model as string | undefined;
  const appliedUserId = params.userId as string | undefined;
  const appliedStatus = params.status as string | undefined;

  const appliedChips: AppliedFilter[] = [
    appliedStatus
      ? {
          key: 'status',
          label: `状态：${STATUS_LABELS[appliedStatus] ?? appliedStatus}`,
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

  const columns: Array<AdminColumn<BillingOrderView>> = useMemo(
    () => [
      {
        key: 'createdAt',
        title: '时间',
        width: 150,
        render: (row) => (
          <span className="text-[11px] tabular-nums text-muted-foreground">
            {new Date(row.createdAt).toLocaleString('zh-CN')}
          </span>
        ),
      },
      {
        key: 'user',
        title: '用户',
        width: 180,
        render: (row) => (
          <div className="min-w-0">
            <div className="truncate text-[11px] text-foreground">{row.userEmail || '—'}</div>
            <div className="truncate font-mono text-[10px] text-muted-foreground">{row.userId}</div>
          </div>
        ),
      },
      {
        key: 'model',
        title: '模型 / 能力',
        width: 170,
        render: (row) => (
          <div className="min-w-0">
            <div className="truncate font-mono text-[11px] text-foreground">{row.model || '—'}</div>
            <div className="truncate text-[10px] text-muted-foreground">
              {row.capability}
              {row.scene ? ` · ${row.scene}` : ''}
            </div>
          </div>
        ),
      },
      {
        key: 'channel',
        title: '渠道',
        width: 180,
        render: (row) => (
          <div className="min-w-0">
            <div className="truncate text-[11px] text-foreground">{row.channelName || '—'}</div>
            <div className="truncate text-[10px] text-muted-foreground">{row.channelModelName || '—'}</div>
          </div>
        ),
      },
      {
        key: 'billing',
        title: '计费',
        width: 120,
        render: (row) => (
          <div className="flex flex-col gap-0.5 text-[11px]">
            <span className="text-foreground">{BILLING_MODE_LABELS[row.billingMode] ?? row.billingMode}</span>
            <span className="tabular-nums text-muted-foreground">
              数量 {row.quantity}
              {row.multiplierBasisPoints !== 10000 ? ` · 倍率 ${row.multiplierBasisPoints / 100}%` : ''}
            </span>
          </div>
        ),
      },
      {
        key: 'amount',
        title: '金额（积分）',
        width: 130,
        align: 'right',
        render: (row) => (
          <div className="flex flex-col gap-0.5 text-[11px] tabular-nums">
            <span className="text-foreground">{toCredits(row.actualAmountMicrocredits || row.reservedAmountMicrocredits)}</span>
            {row.refundedAmountMicrocredits > 0 && (
              <span className="text-warn-text">退 {toCredits(row.refundedAmountMicrocredits)}</span>
            )}
          </div>
        ),
      },
      {
        key: 'status',
        title: '状态',
        width: 100,
        render: (row) => (
          <StatusTag
            status={row.status}
            tone={STATUS_TONES[row.status] ?? 'muted'}
            label={STATUS_LABELS[row.status] ?? row.status}
          />
        ),
      },
      {
        key: 'ops',
        title: '操作',
        width: 80,
        fixed: 'right',
        render: (row) => (
          <ActionButton
            variant="ghost"
            size="xs"
            onClick={() => {
              setReason('');
              setAction('settle');
              setDetailId(row.id);
            }}
          >
            详情
          </ActionButton>
        ),
      },
    ],
    [setDetailId],
  );

  return (
    <>
      <PageHeader
        title="生成账单"
        description="一次任务一条账单。人工核对只做结算或全额退款，金额口径完全由计费服务决定。"
      />

      <div className="mb-3 grid grid-cols-5 gap-3">
        {Object.entries(STATUS_LABELS).map(([key, label]) => (
          <StatCard
            key={key}
            label={label}
            value={statusCounts[key] ?? 0}
            tone={key === 'uncertain' && (statusCounts[key] ?? 0) > 0 ? 'danger' : undefined}
          />
        ))}
      </div>

      <FilterBar>
        <SelectField
          ariaLabel="账单状态"
          value={status}
          options={STATUS_OPTIONS}
          allowClear
          onChange={setStatus}
        />
        <SelectField
          ariaLabel="计费方式"
          value={billingMode}
          options={[
            { value: 'fixed_request', label: '按次' },
            { value: 'per_second', label: '按秒' },
            { value: 'token', label: '按 Token' },
          ]}
          allowClear
          onChange={setBillingMode}
        />
        <TextField
          ariaLabel="模型编码"
          value={model}
          onChange={setModel}
          placeholder="前台模型编码"
          onEnter={applyFilters}
        />
        <TextField
          ariaLabel="用户 ID"
          value={userId}
          onChange={setUserId}
          placeholder="用户 ID"
          onEnter={applyFilters}
        />
        <TextField
          ariaLabel="任务 ID"
          value={taskId}
          onChange={setTaskId}
          placeholder="任务 ID"
          onEnter={applyFilters}
        />
        <TextField ariaLabel="开始日期" type="date" value={from} onChange={setFrom} />
        <TextField ariaLabel="结束日期" type="date" value={to} onChange={setTo} />
        <FilterActions>
          <ActionButton variant="default" size="sm" onClick={applyFilters}>
            查询
          </ActionButton>
          <ActionButton variant="secondary" size="sm" onClick={resetFilters}>
            重置
          </ActionButton>
        </FilterActions>
        <AppliedFilters items={appliedChips} onClearAll={resetFilters} />
      </FilterBar>

      <Panel title="账单列表" note="「结果不明」既不切线也不退款，需要人工核对后落到结算或退款。">
        {error && rows.length > 0 && <StaleError error={error} onRetry={() => void reload()} />}
        <AdminDataTable<BillingOrderView>
          rows={rows}
          columns={columns}
          rowKey={(row) => row.id}
          loading={loading}
          error={rows.length === 0 ? error : null}
          onRetry={() => void reload()}
          emptyText="没有账单。生成任务成功后才会产生账单记录。"
          minWidth={1220}
          pagination={{
            current: Number(params.page ?? 1),
            pageSize: Number(params.pageSize ?? 20),
            total: data?.total ?? 0,
            onChange: (page, pageSize) => setPage(page, pageSize),
          }}
        />
      </Panel>

      <Drawer
        open={detailId !== null}
        onOpenChange={(open) => {
          if (!open) requestCloseDetail();
        }}
        width={720}
        title="账单详情"
        description={detail ? `${STATUS_LABELS[detail.status] ?? detail.status} · ${detail.id}` : undefined}
        footer={
          <>
            <ActionButton
              variant="secondary"
              size="sm"
              onClick={requestCloseDetail}
              disabled={resolving}
            >
              关闭
            </ActionButton>
            {resolvable && detail && (detail.status === 'uncertain' || detail.status === 'reserved' || detail.status === 'running') && (
              <ActionButton
                variant="default"
                size="sm"
                disabled={resolving || !reason.trim()}
                onClick={() => void runResolve()}
              >
                {resolving ? '处理中…' : action === 'refund' ? '确认退款' : '确认结算'}
              </ActionButton>
            )}
          </>
        }
      >
        {detail ? (
          <div className="flex flex-col gap-4">
            <Descriptions
              items={[
                { label: '状态', value: STATUS_LABELS[detail.status] ?? detail.status },
                { label: '用户', value: `${detail.userEmail || '—'}（${detail.userId}）` },
                { label: '任务', value: <span className="font-mono text-xs">{detail.taskId || '—'}</span> },
                { label: '前台模型', value: detail.model || '—' },
                { label: '能力 / 场景', value: `${detail.capability}${detail.scene ? ` · ${detail.scene}` : ''}` },
                { label: '用户分组', value: detail.userGroup || 'default' },
                { label: '渠道', value: `${detail.channelName || '—'}（${detail.channelId || '—'}）` },
                { label: '渠道模型', value: detail.channelModelName || detail.channelModelId || '—' },
                { label: '价格档', value: detail.priceTierId || '—' },
                {
                  label: '计费方式',
                  value: `${BILLING_MODE_LABELS[detail.billingMode] ?? detail.billingMode} · 数量 ${detail.quantity}`,
                },
                { label: '单价', value: `${toCreditsInput(detail.unitPriceMicrocredits)} 积分` },
                { label: '倍率', value: `${detail.multiplierBasisPoints / 100}%` },
                { label: '预留金额', value: `${toCredits(detail.reservedAmountMicrocredits)} 积分` },
                { label: '实际金额', value: `${toCredits(detail.actualAmountMicrocredits)} 积分` },
                { label: '已退金额', value: `${toCredits(detail.refundedAmountMicrocredits)} 积分` },
                {
                  label: '成本',
                  value: detail.costConfigured
                    ? `${toCredits(detail.costAmountMicrocredits)} 积分`
                    : '未配置成本价',
                },
                {
                  label: 'Token 用量',
                  value: detail.usageAvailable
                    ? `输入 ${detail.inputTokens} · 输出 ${detail.outputTokens} · 缓存 ${detail.cachedTokens}（${detail.usageSource}）`
                    : '无用量数据',
                },
                { label: '开始 / 结算', value: `${formatTime(detail.startedAt)} / ${formatTime(detail.settledAt)}` },
                { label: '退款时间', value: formatTime(detail.refundedAt) },
                { label: '上游请求号', value: <span className="font-mono text-xs">{detail.providerRequestId || '—'}</span> },
              ]}
              columns={2}
            />

            {detail.errorText && (
              <Notice tone="danger" title="失败原因">
                {detail.errorText}
              </Notice>
            )}
            {detail.resolutionNote && (
              <Notice tone="info" title="人工核对记录">
                {detail.resolutionNote}
                {detail.resolvedBy ? `（操作人 ${detail.resolvedBy}）` : ''}
              </Notice>
            )}

            {resolvable &&
              (detail.status === 'uncertain' || detail.status === 'reserved' || detail.status === 'running') && (
                <div className="rounded-lg border border-border p-3">
                  <div className="mb-2 text-xs font-semibold text-foreground">人工核对</div>
                  <div className="mb-2 flex gap-2">
                    <ActionButton
                      variant={action === 'settle' ? 'default' : 'secondary'}
                      size="sm"
                      onClick={() => setAction('settle')}
                    >
                      按现有用量结算
                    </ActionButton>
                    <ActionButton
                      variant={action === 'refund' ? 'destructive' : 'secondary'}
                      size="sm"
                      onClick={() => setAction('refund')}
                    >
                      全额退款
                    </ActionButton>
                  </div>
                  <TextAreaField
                    ariaLabel="核对依据"
                    value={reason}
                    onChange={setReason}
                    rows={3}
                    maxLength={200}
                    placeholder="写清核对依据，如：上游确认出图成功但回调丢失"
                  />
                  {action === 'refund' && (
                    <p className="mt-1 text-[11px] text-danger-text">
                      退款会按预留金额原额退回用户积分，且不可撤销。
                    </p>
                  )}
                </div>
              )}
          </div>
        ) : (
          <p className="py-6 text-center text-xs text-muted-foreground">
            该账单不在当前页。请回到列表按任务 ID 或用户 ID 定位。
          </p>
        )}
      </Drawer>
    </>
  );
}

function formatTime(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleString('zh-CN');
}
